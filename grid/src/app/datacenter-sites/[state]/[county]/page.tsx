import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { STATES, stateBySlug, countySlug, siteTypeLabel, SITE_TYPES } from "@/lib/geo";
import { findCountyBySlug, indexableCounties, type CountyRollup } from "@/lib/rollups";
import { topSites, countyDetail, type CountyDetail } from "@/lib/db";
import {
  fmtInt,
  fmtScore,
  fmtMwExact,
  fmtCents,
  fmtUsd,
} from "@/lib/format";
import StatBand from "@/components/StatBand";
import Breakdown from "@/components/Breakdown";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import {
  breadcrumbSchema,
  datasetSchema,
  placeSchema,
  faqSchema,
} from "@/lib/schema";

export const revalidate = 86400;
export const dynamicParams = true;

// Static-generate counties with >=10 sites; >=5 render on demand (ISR).
export function generateStaticParams() {
  const out: Array<{ state: string; county: string }> = [];
  for (const c of indexableCounties(10)) {
    if (!c.state || !c.countyName) continue;
    const st = STATES.find((s) => s.code === c.state);
    if (!st) continue;
    out.push({ state: st.slug, county: countySlug(c.countyName) });
  }
  return out;
}

function resolve(
  stateSlug: string,
  countySlugStr: string
): { fips: string; county: CountyRollup; stateName: string; stateSlug: string } | null {
  const st = stateBySlug(stateSlug);
  if (!st) return null;
  const found = findCountyBySlug(st.code, countySlugStr, countySlug);
  if (!found) return null;
  return { fips: found.fips, county: found.county, stateName: st.name, stateSlug: st.slug };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}): Promise<Metadata> {
  const { state, county } = await params;
  const r = resolve(state, county);
  if (!r || r.county.count < 5) {
    return {
      title: "County not found",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `Datacenter Sites in ${r.county.countyName}, ${r.stateName}`,
    description: `${fmtInt(r.county.count)} scored datacenter candidate sites in ${r.county.countyName}, ${r.stateName}, averaging ${fmtScore(
      r.county.avgScore
    )}/100 DC Readiness — with hazard rating, tax incentives, electricity rates, fiber, water stress, and climate context.`,
    alternates: { canonical: `${SITE_URL}/datacenter-sites/${r.stateSlug}/${county}` },
  };
}

function YesNo({ v }: { v: boolean | null | undefined }) {
  return <>{v == null ? "—" : v ? "Yes" : "No"}</>;
}

export default async function CountyPage({
  params,
}: {
  params: Promise<{ state: string; county: string }>;
}) {
  const { state, county } = await params;
  const r = resolve(state, county);
  if (!r || r.county.count < 5) notFound();

  const [sites, detail] = await Promise.all([
    topSites({ fips_code: r.fips }, 25),
    countyDetail(r.fips),
  ]);

  const typeRows = Object.entries(r.county.byType).map(([k, n]) => ({
    label: siteTypeLabel(k),
    count: n,
    href: SITE_TYPES[k] ? `/site-types/${SITE_TYPES[k].slug}/${r.stateSlug}` : undefined,
  }));

  const d: CountyDetail | null = detail;

  const faq = [
    {
      q: `How many datacenter sites are in ${r.county.countyName}?`,
      a: `${fmtInt(r.county.count)} scored datacenter candidate sites, averaging ${fmtScore(r.county.avgScore)}/100 DC Readiness.`,
    },
    d?.has_dc_tax_incentive
      ? {
          q: `Does ${r.county.countyName} offer datacenter tax incentives?`,
          a: d.dc_incentive_details
            ? d.dc_incentive_details
            : `Yes — ${r.county.countyName} has a datacenter tax incentive on record (${d.dc_incentive_type ?? "incentive"}).`,
        }
      : {
          q: `Does ${r.county.countyName} offer datacenter tax incentives?`,
          a: `No datacenter-specific tax incentive is on record for ${r.county.countyName} in our dataset.`,
        },
    d?.nri_rating
      ? {
          q: `What is the natural-hazard risk in ${r.county.countyName}?`,
          a: `FEMA's National Risk Index rates ${r.county.countyName} as "${d.nri_rating}"${
            d.nri_score != null ? ` (score ${d.nri_score})` : ""
          }.`,
        }
      : null,
    d?.avg_industrial_rate_cents_kwh != null
      ? {
          q: `What are industrial electricity rates in ${r.county.countyName}?`,
          a: `Average industrial electricity is ${fmtCents(d.avg_industrial_rate_cents_kwh)} and commercial is ${fmtCents(d.avg_commercial_rate_cents_kwh)} in ${r.county.countyName}.`,
        }
      : null,
  ].filter(Boolean) as { q: string; a: string }[];

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Locations", url: "/datacenter-sites" },
            { name: r.stateName, url: `/datacenter-sites/${r.stateSlug}` },
            { name: r.county.countyName, url: `/datacenter-sites/${r.stateSlug}/${county}` },
          ]),
          placeSchema({ name: `${r.county.countyName}, ${r.stateName}`, type: "AdministrativeArea" }),
          datasetSchema({
            name: `Datacenter candidate sites in ${r.county.countyName}, ${r.stateName}`,
            description: `${fmtInt(r.county.count)} scored datacenter candidate sites in ${r.county.countyName}.`,
            url: `${SITE_URL}/datacenter-sites/${r.stateSlug}/${county}`,
            spatialCoverage: `${r.county.countyName}, ${r.stateName}`,
          }),
          faqSchema(faq),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/datacenter-sites" className="hover:text-purple-600">Locations</a> /{" "}
        <a href={`/datacenter-sites/${r.stateSlug}`} className="hover:text-purple-600">{r.stateName}</a> /{" "}
        {r.county.countyName}
      </nav>

      <header className="mt-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Datacenter Sites in {r.county.countyName}, {r.stateName}
        </h1>
        <p className="mt-2 max-w-3xl text-gray-700">
          {r.county.countyName} has {fmtInt(r.county.count)} scored datacenter
          candidate sites averaging {fmtScore(r.county.avgScore)}/100 DC
          Readiness, with a catalogued aggregate of{" "}
          {fmtMwExact(r.county.totalCapacityMw)}.
          {d?.nri_rating ? ` FEMA rates local natural-hazard risk as "${d.nri_rating}".` : ""}
          {d?.has_dc_tax_incentive ? " The county has a datacenter tax incentive on record." : ""}
        </p>
      </header>

      <section className="mt-6">
        <StatBand
          stats={[
            { label: "Candidate sites", value: fmtInt(r.county.count) },
            { label: "Avg DC Readiness", value: `${fmtScore(r.county.avgScore)}/100` },
            { label: "Catalogued capacity", value: fmtMwExact(r.county.totalCapacityMw), sub: "theoretical aggregate" },
            { label: "Hazard rating", value: d?.nri_rating ?? "—" },
          ]}
        />
      </section>

      {/* County context grid (live grid_county_data) */}
      {d && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">
            Site-selection context for {r.county.countyName}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ContextCard label="Datacenter tax incentive">
              <YesNo v={d.has_dc_tax_incentive} />
              {d.dc_incentive_type ? (
                <span className="block text-xs text-gray-500">{d.dc_incentive_type}</span>
              ) : null}
            </ContextCard>
            <ContextCard label="Commercial electricity">{fmtCents(d.avg_commercial_rate_cents_kwh)}</ContextCard>
            <ContextCard label="Industrial electricity">{fmtCents(d.avg_industrial_rate_cents_kwh)}</ContextCard>
            <ContextCard label="Fiber providers">
              {d.fiber_provider_count != null ? fmtInt(d.fiber_provider_count) : <YesNo v={d.has_fiber} />}
            </ContextCard>
            <ContextCard label="Water stress">{d.water_stress_label ?? "—"}</ContextCard>
            <ContextCard label="Land price / acre">{fmtUsd(d.land_price_per_acre)}</ContextCard>
            <ContextCard label="Cooling degree days">{d.cooling_degree_days != null ? fmtInt(d.cooling_degree_days) : "—"}</ContextCard>
            <ContextCard label="Heating degree days">{d.heating_degree_days != null ? fmtInt(d.heating_degree_days) : "—"}</ContextCard>
            <ContextCard label="Mean annual temp">{d.mean_annual_temp_f != null ? `${d.mean_annual_temp_f}°F` : "—"}</ContextCard>
          </div>
          {d.dc_incentive_details && (
            <p className="mt-3 rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm text-gray-700">
              <strong>Incentive detail:</strong> {d.dc_incentive_details}
            </p>
          )}
        </section>
      )}

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">By site type</h2>
        <Breakdown rows={typeRows} />
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-gray-900">
          Top datacenter sites in {r.county.countyName}
        </h2>
        <div className="mt-3">
          <SitesTable
            sites={sites}
            showCounty={false}
            caption={`Top datacenter sites in ${r.county.countyName}`}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-gray-900">
          {r.county.countyName} datacenter FAQ
        </h2>
        <dl className="mt-3 space-y-4">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-gray-900">{f.q}</dt>
              <dd className="mt-1 text-gray-700">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-8">
        <Freshness />
      </div>
      <UpgradeCTA context={`${r.county.countyName}, ${r.stateName}`} />
    </div>
  );
}

function ContextCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-base font-semibold text-gray-900">{children}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
    </div>
  );
}
