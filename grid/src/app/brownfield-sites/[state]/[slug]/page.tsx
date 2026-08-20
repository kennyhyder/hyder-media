import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { stateBySlug, stateName } from "@/lib/geo";
import {
  getBrownfieldByShortId,
  getCountyByStateAndName,
  nearbySitesByLatLng,
  nearbyBrownfieldsByLatLng,
  nearbyIxpsByLatLng,
  type BrownfieldSite,
  type DcSite,
} from "@/lib/db";
import { parseShortId, siteProfilePath, ixpProfilePath, brownfieldProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtKv, fmtMwExact, fmtCents, fmtUsd, fmtScore } from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import PrintButton from "@/components/PrintButton";
import LeadCapture from "@/components/LeadCapture";
import JsonLd from "@/components/JsonLd";
import { Row, Card, km2mi } from "@/components/EntityProfile";
import OrgLink from "@/components/OrgLink";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";
import { getPageOverride, applyOverride } from "@/lib/gsc/page-override";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() {
  return [] as Array<{ state: string; slug: string }>;
}

interface Resolved {
  bf: BrownfieldSite;
  stateNm: string;
  stateSlug: string;
}

async function resolve(stateSlug: string, slug: string): Promise<Resolved | null> {
  const st = stateBySlug(stateSlug);
  if (!st) return null;
  const shortId = parseShortId(slug);
  if (!shortId) return null;
  const bf = await getBrownfieldByShortId(st.code, shortId);
  if (!bf) return null;
  return { bf, stateNm: st.name, stateSlug: st.slug };
}

function shouldIndex(bf: BrownfieldSite): boolean {
  return !!bf.name && bf.state != null && bf.latitude != null && bf.longitude != null;
}

const FORMER_USE_LABEL: Record<string, string> = {
  gas: "natural gas plant",
  coal: "coal plant",
  oil: "oil plant",
  nuclear: "nuclear plant",
  petroleum: "petroleum plant",
};

function formerUseLabel(u: string | null | undefined): string {
  if (!u) return "retired generation site";
  return FORMER_USE_LABEL[u.toLowerCase()] || `former ${u} site`;
}

// Great-circle miles between two lat/lng points (for the nearby-sites screen).
function milesBetween(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null
): number | null {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// NRI sub-hazard score (0–100) → short label.
function riskLabel(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  const band = v >= 80 ? "Very high" : v >= 60 ? "High" : v >= 40 ? "Moderate" : v >= 20 ? "Low" : "Very low";
  return `${band} (${Math.round(v)}/100)`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}): Promise<Metadata> {
  const { state, slug } = await params;
  const r = await resolve(state, slug);
  if (!r) return { title: "Brownfield site not found", robots: { index: false, follow: false } };
  const { bf } = r;
  const name = bf.name || "Retired Power Plant Site";
  const loc = [bf.city, bf.county].filter(Boolean).join(", ") || r.stateNm;
  const cap =
    bf.existing_capacity_mw != null ? `${fmtMwExact(bf.existing_capacity_mw)} legacy capacity` : null;
  const descParts = [
    `Former ${formerUseLabel(bf.former_use)}`,
    cap,
    bf.retirement_date ? `retired ${bf.retirement_date}` : null,
  ].filter(Boolean);
  const base = {
    title: `${name} — Brownfield Datacenter Site in ${loc}, ${r.stateNm}`,
    description: `${name}, a ${formerUseLabel(
      bf.former_use
    )} brownfield in ${loc}, ${r.stateNm}, evaluated for datacenter redevelopment. ${descParts.join(
      " · "
    )}. Existing grid hookup, retirement status, and nearby candidate sites.`,
  };
  const override = await getPageOverride(`/brownfield-sites/${r.stateSlug}/${slug}`);
  return {
    ...applyOverride(base, override),
    alternates: { canonical: `${SITE_URL}/brownfield-sites/${r.stateSlug}/${slug}` },
    robots: shouldIndex(bf) ? undefined : { index: false, follow: true },
  };
}

export default async function BrownfieldProfilePage({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}) {
  const { state, slug } = await params;
  const r = await resolve(state, slug);
  if (!r) notFound();
  const { bf } = r;

  const [nearby, ixps, county, nearbyBf] = await Promise.all([
    nearbySitesByLatLng(bf.latitude, bf.longitude, 8),
    nearbyIxpsByLatLng(bf.latitude, bf.longitude, 4),
    getCountyByStateAndName(bf.state, bf.county),
    nearbyBrownfieldsByLatLng(bf.latitude, bf.longitude, 8, bf.id),
  ]);

  const name = bf.name || "Retired Power Plant Site";
  const loc = [bf.city, bf.county].filter(Boolean).join(", ") || r.stateNm;
  const profilePath = `/brownfield-sites/${r.stateSlug}/${slug}`;
  const stateHref = `/datacenter-sites/${r.stateSlug}`;
  const nearbyLink = (s: DcSite) => siteProfilePath(s);

  const placeLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description: `Brownfield / retired power plant site in ${loc}, ${r.stateNm}, evaluated for datacenter redevelopment.`,
    address: {
      "@type": "PostalAddress",
      addressRegion: bf.state,
      addressLocality: bf.city || bf.county || undefined,
      addressCountry: "US",
    },
    url: `${SITE_URL}${profilePath}`,
  };
  if (bf.latitude != null && bf.longitude != null) {
    placeLd.geo = { "@type": "GeoCoordinates", latitude: bf.latitude, longitude: bf.longitude };
  }

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Brownfield Sites", url: "/brownfield-sites" },
            { name: r.stateNm, url: `/brownfield-sites/${r.stateSlug}` },
            { name, url: profilePath },
          ]),
          placeLd,
          datasetSchema({
            name: `${name} — brownfield datacenter redevelopment profile`,
            description: `Former use, existing capacity, retirement status, and grid hookup for ${name} in ${loc}, ${r.stateNm}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: bf.created_at ?? freshness(),
            spatialCoverage: `${loc}, ${r.stateNm}`,
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/brownfield-sites" className="hover:text-purple-600">Brownfield Sites</a> /{" "}
        <a href={`/brownfield-sites/${r.stateSlug}`} className="hover:text-purple-600">{r.stateNm}</a> /{" "}
        <span className="text-gray-500">{name}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
            <span className="rounded bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              Brownfield
            </span>
          </div>
          <p className="mt-1 text-gray-600">
            {loc}, {stateName(bf.state || "")}
            {bf.operator_name ? ` · ${bf.operator_name}` : ""}
          </p>
        </div>
        {bf.existing_capacity_mw != null && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500">Legacy capacity</div>
            <div className="inline-block rounded-lg bg-emerald-100 px-3 py-1 text-3xl font-bold text-emerald-800">
              {fmtInt(bf.existing_capacity_mw)}
            </div>
            <div className="mt-0.5 text-xs font-medium text-gray-500">MW</div>
          </div>
        )}
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PrintButton />
      </div>

      <p className="mt-4 max-w-3xl text-gray-700">
        {name} is a {formerUseLabel(bf.former_use)} in {loc}, {r.stateNm}
        {bf.retirement_date ? `, retired ${bf.retirement_date}` : ""}. Retired generation sites are
        among the most attractive datacenter redevelopment targets: the existing interconnection
        was sized for{" "}
        {bf.existing_capacity_mw != null
          ? `roughly ${fmtMwExact(bf.existing_capacity_mw)} of generation`
          : "utility-scale generation"}
        , so the grid hookup, transmission rights, and often cooling-water access are already in
        place — collapsing the speed-to-power timeline versus a greenfield build.
      </p>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Former use & capacity">
          <Row label="Former use" value={bf.former_use ? formerUseLabel(bf.former_use) : null} />
          <Row label="Site type" value={bf.site_type} />
          <Row
            label="Existing capacity"
            value={bf.existing_capacity_mw != null ? fmtMwExact(bf.existing_capacity_mw) : null}
          />
          <Row label="Retirement date" value={bf.retirement_date} />
          <Row label="EIA plant ID" value={bf.eia_plant_id != null ? `#${bf.eia_plant_id}` : null} />
          <Row label="Acreage" value={bf.acreage != null ? `${fmtInt(bf.acreage)} ac` : null} />
        </Card>

        <Card title="Grid hookup & remediation">
          <Row
            label="Grid connection voltage"
            value={bf.grid_connection_voltage_kv != null ? fmtKv(bf.grid_connection_voltage_kv) : null}
          />
          <Row label="Nearest substation" value={km2mi(bf.nearest_substation_distance_km)} />
          <Row label="Cleanup status" value={bf.cleanup_status} />
          <Row label="Contaminant type" value={bf.contaminant_type} />
          <Row label="EPA ID" value={bf.epa_id} />
          <Row label="Operator" value={bf.operator_name ? <OrgLink owner={bf.operator_name} /> : null} />
          <Row label="Operator address" value={bf.operator_address} />
          <Row label="Operator phone" value={bf.operator_phone} />
        </Card>
      </section>

      <section className="mt-6 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-gray-700">
        <strong>Why this site is datacenter-attractive:</strong> a {formerUseLabel(bf.former_use)} of
        this scale leaves behind a high-capacity grid interconnection that a new load can re-use,
        frequently shaving years off the interconnection queue. Retired-plant sites also tend to be
        already zoned for heavy industrial use with established road, rail, and water infrastructure.
      </section>

      {county && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">
            Site conditions &amp; market — {county.county_name || loc}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            County-level intelligence for this site&apos;s location — the power economics, water,
            hazard, connectivity, and workforce a developer screens before ever visiting. Assembled
            from FEMA NRI, BLS QCEW, FCC BDC, USGS water-use, and EIA.
          </p>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <Card title="Market &amp; workforce">
              <Row label="Population" value={county.population != null ? fmtInt(county.population) : null} />
              <Row
                label="Total employment (laborshed)"
                value={county.total_employment != null ? fmtInt(county.total_employment) : null}
              />
              <Row label="IT / tech employment" value={county.it_employment != null ? fmtInt(county.it_employment) : null} />
              <Row
                label="Construction employment"
                value={county.construction_employment != null ? fmtInt(county.construction_employment) : null}
              />
              <Row
                label="Land value"
                value={county.land_price_per_acre != null ? `${fmtUsd(county.land_price_per_acre)}/acre` : null}
              />
              <Row
                label="Datacenter tax incentive"
                value={county.has_dc_tax_incentive ? county.dc_incentive_type || "Yes" : null}
              />
            </Card>

            <Card title="Power economics &amp; interconnection">
              <Row
                label="Commercial power rate"
                value={county.avg_commercial_rate_cents_kwh != null ? fmtCents(county.avg_commercial_rate_cents_kwh) : null}
              />
              <Row
                label="Industrial power rate"
                value={county.avg_industrial_rate_cents_kwh != null ? fmtCents(county.avg_industrial_rate_cents_kwh) : null}
              />
              <Row
                label="Load growth (FERC-714)"
                value={county.ferc714_load_growth_pct != null ? `${county.ferc714_load_growth_pct.toFixed(1)}%` : null}
              />
              <Row
                label="Proposed generation nearby"
                value={
                  county.proposed_generation_mw != null
                    ? `${fmtMwExact(county.proposed_generation_mw)}${
                        county.proposed_generator_count ? ` · ${fmtInt(county.proposed_generator_count)} projects` : ""
                      }`
                    : null
                }
              />
            </Card>

            <Card title="Water &amp; cooling">
              <Row label="Water stress" value={county.water_stress_label} />
              <Row
                label="Public water supply"
                value={county.public_supply_mgd != null ? `${county.public_supply_mgd.toFixed(1)} MGD` : null}
              />
              <Row
                label="Industrial water use"
                value={county.industrial_water_mgd != null ? `${county.industrial_water_mgd.toFixed(1)} MGD` : null}
              />
              <Row
                label="Cooling degree days"
                value={county.cooling_degree_days != null ? fmtInt(county.cooling_degree_days) : null}
              />
              <Row
                label="Mean annual temp"
                value={county.mean_annual_temp_f != null ? `${Math.round(county.mean_annual_temp_f)}°F` : null}
              />
            </Card>

            <Card title="Hazard, flood &amp; connectivity">
              <Row
                label="FEMA risk index"
                value={
                  county.nri_score != null
                    ? `${fmtScore(county.nri_score)}${county.nri_rating ? ` · ${county.nri_rating}` : ""}`
                    : null
                }
              />
              <Row label="Flood risk" value={riskLabel(county.nri_flooding)} />
              <Row label="Coastal flood risk" value={riskLabel(county.nri_coastal_flooding)} />
              <Row
                label="Fiber providers"
                value={
                  county.fiber_provider_count != null
                    ? `${fmtInt(county.fiber_provider_count)}${
                        county.fiber_served_pct != null ? ` · ${Math.round(county.fiber_served_pct)}% served` : ""
                      }`
                    : null
                }
              />
            </Card>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            County-level context — address-level utility offerings and flood zoning vary within the
            county. Confirm site-specific service with the utility and a Phase I ESA.
          </p>
        </section>
      )}

      {nearbyBf.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">Nearby brownfield &amp; retired-generation sites</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            A proximity screen of other retired-plant, contaminated, and EPA-flagged sites near{" "}
            {name} — the environmental neighborhood, ranked by legacy grid capacity.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Former use</th>
                  <th className="py-2 pr-3 font-medium text-right">Legacy MW</th>
                  <th className="py-2 pr-3 font-medium text-right">Distance</th>
                  <th className="py-2 font-medium">Cleanup status</th>
                </tr>
              </thead>
              <tbody>
                {nearbyBf.map((b) => {
                  const mi = milesBetween(bf.latitude, bf.longitude, b.latitude, b.longitude);
                  const href = brownfieldProfilePath(b);
                  return (
                    <tr key={b.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {href ? (
                          <a href={href} className="font-medium text-purple-700 hover:underline">
                            {b.name}
                          </a>
                        ) : (
                          <span className="font-medium text-gray-900">{b.name}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">{formerUseLabel(b.former_use)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                        {b.existing_capacity_mw != null ? fmtInt(b.existing_capacity_mw) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                        {mi != null ? `${mi.toFixed(1)} mi` : "—"}
                      </td>
                      <td className="py-2 text-gray-600">{b.cleanup_status || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Derived from GridCensus&apos;s retired-generator &amp; EPA brownfield dataset. Not a
            substitute for an ASTM E1527 Phase I environmental radius report.
          </p>
        </section>
      )}

      <div className="mt-8">
        <LeadCapture
          variant="watch"
          entityType="brownfield"
          entityId={bf.id}
          entityName={name}
        />
      </div>

      {nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">Nearby datacenter candidate sites</h2>
          <p className="mt-1 text-sm text-gray-600">
            Scored candidate sites near {name}, ranked by DC Readiness.
          </p>
          <div className="mt-3">
            <SitesTable
              sites={nearby}
              showState
              showCounty
              caption={`Candidate sites near ${name}`}
              linkBuilder={nearbyLink}
            />
          </div>
        </section>
      )}

      {ixps.length > 0 && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Nearby internet exchanges</h2>
          <ul className="space-y-1.5 text-sm">
            {ixps.map((x) => (
              <li key={x.id} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 last:border-0">
                <a href={ixpProfilePath(x)} className="font-medium text-purple-700 hover:underline">
                  {x.name}
                </a>
                <span className="text-gray-500">
                  {[x.city, x.state].filter(Boolean).join(", ")}
                  {x.network_count != null ? ` · ${fmtInt(x.network_count)} networks` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-sm">
        <a href={stateHref} className="font-medium text-purple-700 hover:underline">
          See all datacenter sites in {r.stateNm} →
        </a>
      </p>

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Brownfield attributes are derived from EIA retired-generator and EPA public data. Existing
        capacity reflects the retired plant&apos;s historical nameplate, not deliverable
        interconnection for a new load. Confirm reusable interconnection rights, remediation status,
        and site availability with the utility, ISO, and current owner.
      </p>
      <UpgradeCTA context={`${name}, ${loc}, ${r.stateNm}`} />
    </div>
  );
}
