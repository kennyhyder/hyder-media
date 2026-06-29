import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import { stateBySlug, stateName } from "@/lib/geo";
import {
  getBrownfieldByShortId,
  nearbySitesByLatLng,
  nearbyIxpsByLatLng,
  type BrownfieldSite,
  type DcSite,
} from "@/lib/db";
import { parseShortId, siteProfilePath, ixpProfilePath } from "@/lib/entity-slug";
import { fmtInt, fmtKv, fmtMwExact } from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import { Row, Card, km2mi } from "@/components/EntityProfile";
import OrgLink from "@/components/OrgLink";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";

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
  return {
    title: `${name} — Brownfield Datacenter Site in ${loc}, ${r.stateNm} | GridCensus`,
    description: `${name}, a ${formerUseLabel(
      bf.former_use
    )} brownfield in ${loc}, ${r.stateNm}, evaluated for datacenter redevelopment. ${descParts.join(
      " · "
    )}. Existing grid hookup, retirement status, and nearby candidate sites.`,
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

  const [nearby, ixps] = await Promise.all([
    nearbySitesByLatLng(bf.latitude, bf.longitude, 8),
    nearbyIxpsByLatLng(bf.latitude, bf.longitude, 4),
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
        </Card>
      </section>

      <section className="mt-6 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-gray-700">
        <strong>Why this site is datacenter-attractive:</strong> a {formerUseLabel(bf.former_use)} of
        this scale leaves behind a high-capacity grid interconnection that a new load can re-use,
        frequently shaving years off the interconnection queue. Retired-plant sites also tend to be
        already zoned for heavy industrial use with established road, rail, and water infrastructure.
      </section>

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
