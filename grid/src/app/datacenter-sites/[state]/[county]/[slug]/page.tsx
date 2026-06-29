import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/site";
import {
  stateBySlug,
  stateName,
  countySlug,
  siteTypeLabel,
  SITE_TYPES,
  ISO_REGIONS,
  isoLabel,
} from "@/lib/geo";
import { countyRollup } from "@/lib/rollups";
import {
  getSiteByShortId,
  nearbySites,
  countyDetail,
  type FullDcSite,
  type CountyDetail,
  type DcSite,
} from "@/lib/db";
import { parseShortId, siteProfilePath } from "@/lib/entity-slug";
import {
  fmtInt,
  fmtScore,
  fmtMwExact,
  fmtKv,
  fmtYears,
  fmtCents,
  fmtUsd,
  scoreColor,
} from "@/lib/format";
import SitesTable from "@/components/SitesTable";
import OrgLink from "@/components/OrgLink";
import Freshness from "@/components/Freshness";
import UpgradeCTA from "@/components/UpgradeCTA";
import JsonLd from "@/components/JsonLd";
import SiteMiniMap from "@/components/map/SiteMiniMap";
import type { MapSite } from "@/components/map/types";
import { breadcrumbSchema, datasetSchema } from "@/lib/schema";
import { freshness } from "@/lib/rollups";
import SaveButton from "@/components/account/SaveButton";
import SuggestEditButton from "@/components/account/SuggestEditButton";

// On-demand ISR: 164k sites must NOT prerender at build.
export const revalidate = 86400;
export const dynamicParams = true;

// Return [] — every site renders on first request and caches. The sitemap
// enumerates all URLs for crawl discovery. (Top-N could be pre-warmed here,
// but [] keeps the build fast and is explicitly requested.)
export function generateStaticParams() {
  return [] as Array<{ state: string; county: string; slug: string }>;
}

interface Resolved {
  site: FullDcSite;
  stateCode: string;
  stateNm: string;
  stateSlug: string;
  countySlugStr: string;
  countyName: string | null;
}

async function resolve(
  stateSlug: string,
  countySlugStr: string,
  slug: string
): Promise<Resolved | null> {
  const st = stateBySlug(stateSlug);
  if (!st) return null;
  const shortId = parseShortId(slug);
  if (!shortId) return null;
  const site = await getSiteByShortId(st.code, undefined, shortId);
  if (!site) return null;
  // Soft county validation: the resolved site's county slug should match the
  // URL segment. If it doesn't, the URL is stale/wrong → notFound (avoids
  // duplicate content under mismatched county paths).
  const countyName =
    (site.fips_code ? countyRollup(site.fips_code)?.countyName : null) ||
    site.county ||
    null;
  if (countyName && countySlug(countyName) !== countySlugStr) return null;
  return {
    site,
    stateCode: st.code,
    stateNm: st.name,
    stateSlug: st.slug,
    countySlugStr,
    countyName,
  };
}

/** Completeness gate: index only sites with score + fips + state. */
function shouldIndex(site: FullDcSite): boolean {
  return site.dc_score != null && site.fips_code != null && site.state != null;
}

function km2mi(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "—";
  return `${(km * 0.621371).toFixed(1)} mi`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; county: string; slug: string }>;
}): Promise<Metadata> {
  const { state, county, slug } = await params;
  const r = await resolve(state, county, slug);
  if (!r) {
    return { title: "Site not found", robots: { index: false, follow: false } };
  }
  const { site } = r;
  const name = site.name || "Datacenter Candidate Site";
  const score = site.dc_score != null ? `${fmtScore(site.dc_score)}` : "—";
  const countyLabel = r.countyName ?? site.county ?? "—";
  const capacity =
    site.available_capacity_mw != null
      ? `${fmtMwExact(site.available_capacity_mw)} candidate capacity`
      : null;
  const iso = site.iso_region ? `${site.iso_region} grid` : null;
  const wait =
    site.avg_queue_wait_years != null
      ? `${fmtYears(site.avg_queue_wait_years)} avg queue wait`
      : null;
  const descParts = [
    `DC Readiness ${score}/100`,
    capacity,
    iso,
    wait,
  ].filter(Boolean);
  const path = siteProfilePath(site) ?? `/datacenter-sites/${r.stateSlug}/${county}/${slug}`;
  return {
    title: `${name} — Datacenter Site in ${countyLabel}, ${r.stateNm} | DC Readiness ${score}/100`,
    description: `${name}, a ${siteTypeLabel(
      site.site_type || ""
    ).toLowerCase()} datacenter candidate site in ${countyLabel}, ${
      r.stateNm
    }. ${descParts.join(" · ")}. Power, speed-to-power, fiber, water, and hazard screening from public infrastructure data.`,
    alternates: { canonical: `${SITE_URL}${path}` },
    robots: shouldIndex(site)
      ? undefined
      : { index: false, follow: true },
  };
}

// ── Small presentational helpers (server components) ─────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-lg font-bold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

function YesFlag({
  v,
  bad,
}: {
  v: boolean | null | undefined;
  bad?: boolean;
}) {
  if (v == null) return <span className="text-gray-400">—</span>;
  if (!v) return <span className="text-green-600">Clear</span>;
  return (
    <span className={bad ? "text-red-600" : "text-amber-600"}>Present</span>
  );
}

const SUBSCORES: Array<{ key: keyof FullDcSite; label: string; weight: string }> = [
  { key: "score_power", label: "Power availability", weight: "20%" },
  { key: "score_speed_to_power", label: "Speed to power", weight: "15%" },
  { key: "score_fiber", label: "Fiber connectivity", weight: "12%" },
  { key: "score_energy_cost", label: "Energy cost", weight: "10%" },
  { key: "score_water", label: "Water risk", weight: "8%" },
  { key: "score_hazard", label: "Natural hazard", weight: "8%" },
  { key: "score_buildability", label: "Buildability", weight: "7%" },
  { key: "score_labor", label: "Labor market", weight: "4%" },
  { key: "score_existing_dc", label: "DC cluster", weight: "4%" },
  { key: "score_land", label: "Land / acreage", weight: "3%" },
  { key: "score_construction_cost", label: "Construction cost", weight: "3%" },
  { key: "score_gas_pipeline", label: "Gas pipeline", weight: "2%" },
  { key: "score_tax", label: "Tax incentive", weight: "2%" },
  { key: "score_climate", label: "Climate / cooling", weight: "2%" },
];

function ScoreBar({ label, weight, value }: { label: string; weight: string; value: number | null }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const color =
    v == null
      ? "bg-gray-200"
      : v >= 70
      ? "bg-green-500"
      : v >= 50
      ? "bg-yellow-500"
      : v >= 30
      ? "bg-orange-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-36 shrink-0 truncate text-xs text-gray-600" title={label}>
        {label}
      </span>
      <span className="w-8 shrink-0 text-xs text-gray-400">{weight}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
        <div className={`h-full rounded ${color}`} style={{ width: `${v ?? 0}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-700">
        {v == null ? "—" : Math.round(v)}
      </span>
    </div>
  );
}

export default async function SiteProfilePage({
  params,
}: {
  params: Promise<{ state: string; county: string; slug: string }>;
}) {
  const { state, county, slug } = await params;
  const r = await resolve(state, county, slug);
  if (!r) notFound();
  const { site } = r;

  const [detail, nearby] = await Promise.all([
    site.fips_code ? countyDetail(site.fips_code) : Promise.resolve(null),
    nearbySites(site, 8),
  ]);
  const d: CountyDetail | null = detail;

  const name = site.name || "Datacenter Candidate Site";
  const typeInfo = site.site_type ? SITE_TYPES[site.site_type] : undefined;
  const isoInfo = site.iso_region ? ISO_REGIONS[site.iso_region] : undefined;
  const countyLabel = r.countyName ?? site.county ?? "—";
  const countyHref = `/datacenter-sites/${r.stateSlug}/${r.countySlugStr}`;
  const profilePath =
    siteProfilePath(site) ?? `/datacenter-sites/${r.stateSlug}/${county}/${slug}`;
  const isBrownfield =
    site.site_type === "brownfield" || site.former_use != null;

  const score = site.dc_score;
  const scoreText =
    score != null
      ? score >= 70
        ? "Excellent"
        : score >= 55
        ? "Good"
        : score >= 40
        ? "Fair"
        : "Limited"
      : "Unscored";

  const nearbyLink = (s: DcSite) => siteProfilePath(s);

  // Map data (theme-aware client island; page text stays server-rendered).
  const toMapSite = (s: FullDcSite | DcSite): MapSite => ({
    id: s.id,
    name: s.name,
    site_type: s.site_type,
    state: s.state,
    county: s.county,
    latitude: s.latitude,
    longitude: s.longitude,
    dc_score: s.dc_score,
  });
  const mapSite = toMapSite(site);
  const mapNearby = nearby
    .filter((s) => s.latitude != null && s.longitude != null)
    .map(toMapSite);

  // JSON-LD: Place (with geo) + Dataset + BreadcrumbList.
  const placeLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Place",
    name,
    description: `Datacenter candidate site in ${countyLabel}, ${r.stateNm}. DC Readiness ${
      score != null ? fmtScore(score) : "—"
    }/100.`,
    address: {
      "@type": "PostalAddress",
      addressRegion: site.state,
      addressLocality: countyLabel,
      addressCountry: "US",
    },
    url: `${SITE_URL}${profilePath}`,
  };
  if (site.latitude != null && site.longitude != null) {
    placeLd.geo = {
      "@type": "GeoCoordinates",
      latitude: site.latitude,
      longitude: site.longitude,
    };
  }

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbSchema([
            { name: "Home", url: "/" },
            { name: "Locations", url: "/datacenter-sites" },
            { name: r.stateNm, url: `/datacenter-sites/${r.stateSlug}` },
            { name: countyLabel, url: countyHref },
            { name, url: profilePath },
          ]),
          placeLd,
          datasetSchema({
            name: `${name} — datacenter site screening`,
            description: `Power, speed-to-power, fiber, water, and hazard screening for ${name} in ${countyLabel}, ${r.stateNm}.`,
            url: `${SITE_URL}${profilePath}`,
            dateModified: site.updated_at ?? freshness(),
            spatialCoverage: `${countyLabel}, ${r.stateNm}`,
          }),
        ]}
      />

      <nav className="text-xs text-gray-400">
        <a href="/" className="hover:text-purple-600">Home</a> /{" "}
        <a href="/datacenter-sites" className="hover:text-purple-600">Locations</a> /{" "}
        <a href={`/datacenter-sites/${r.stateSlug}`} className="hover:text-purple-600">{r.stateNm}</a> /{" "}
        <a href={countyHref} className="hover:text-purple-600">{countyLabel}</a> /{" "}
        <span className="text-gray-500">{name}</span>
      </nav>

      {/* Hero */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">{name}</h1>
            {site.site_type && (
              <a
                href={typeInfo ? `/site-types/${typeInfo.slug}` : undefined}
                className="rounded bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200"
              >
                {siteTypeLabel(site.site_type)}
              </a>
            )}
          </div>
          <p className="mt-1 text-gray-600">
            {countyLabel}, {stateName(site.state || "")}
            {site.iso_region && (
              <>
                {" · "}
                <a href={isoInfo ? `/iso/${isoInfo.slug}` : undefined} className="hover:text-purple-700 hover:underline">
                  {site.iso_region}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-gray-500">DC Readiness</div>
          <div
            className={`inline-block rounded-lg px-3 py-1 text-3xl font-bold ${scoreColor(score)}`}
          >
            {score != null ? fmtScore(score) : "—"}
          </div>
          <div className="mt-0.5 text-xs font-medium text-gray-500">{scoreText} / 100</div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SaveButton
          entityType="site"
          entityId={site.id}
          label={name}
          meta={{ name, state: site.state, score }}
        />
        <SuggestEditButton
          entityType="site"
          entityId={site.id}
          fields={["name", "available_capacity_mw", "parcel_owner", "acreage", "former_use"]}
        />
      </div>

      <p className="mt-4 max-w-3xl text-gray-700">
        {name} is a {siteTypeLabel(site.site_type || "candidate").toLowerCase()} datacenter
        candidate site in {countyLabel}, {r.stateNm}
        {site.iso_region ? `, interconnecting through ${site.iso_region}` : ""}. It screens at{" "}
        {score != null ? `${fmtScore(score)}/100 DC Readiness` : "an unscored DC Readiness"}
        {site.available_capacity_mw != null
          ? ` with a catalogued ${fmtMwExact(site.available_capacity_mw)} of candidate capacity`
          : ""}
        {site.avg_queue_wait_years != null
          ? ` and a ${fmtYears(site.avg_queue_wait_years)} average interconnection-queue wait`
          : ""}
        .
      </p>

      {/* Detail cards */}
      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card title="Power & interconnection">
          <Row label="Nearest substation" value={site.nearest_substation_name} />
          <Row label="Substation distance" value={km2mi(site.nearest_substation_distance_km)} />
          <Row label="Substation voltage" value={fmtKv(site.substation_voltage_kv)} />
          <Row
            label="Available capacity"
            value={site.available_capacity_mw != null ? fmtMwExact(site.available_capacity_mw) : null}
          />
          <Row label="LMP zone" value={site.lmp_zone || site.iso_lmp_node} />
          <Row
            label="Wholesale LMP"
            value={
              site.lmp_wholesale_mwh != null
                ? `$${site.lmp_wholesale_mwh.toFixed(2)}/MWh`
                : site.iso_lmp_avg != null
                ? `$${site.iso_lmp_avg.toFixed(2)}/MWh`
                : null
            }
          />
          <Row
            label="Utility commercial rate"
            value={
              site.utility_rate_commercial != null
                ? `${site.utility_rate_commercial.toFixed(2)}¢/kWh`
                : null
            }
          />
          <Row label="Utility" value={site.utility_name} />
        </Card>

        <Card title="Speed to power">
          <Row
            label="ISO / RTO region"
            value={
              site.iso_region ? (
                isoInfo ? (
                  <a href={`/iso/${isoInfo.slug}`} className="text-purple-700 hover:underline">
                    {isoLabel(site.iso_region)}
                  </a>
                ) : (
                  site.iso_region
                )
              ) : null
            }
          />
          <Row label="Queue depth" value={site.queue_depth != null ? fmtInt(site.queue_depth) : null} />
          <Row
            label="Avg queue wait"
            value={site.avg_queue_wait_years != null ? fmtYears(site.avg_queue_wait_years) : null}
          />
          <Row
            label="Recent queue wait"
            value={site.recent_queue_wait_years != null ? fmtYears(site.recent_queue_wait_years) : null}
          />
          <Row
            label="Completion rate"
            value={
              site.queue_completion_rate != null
                ? `${(site.queue_completion_rate * 100).toFixed(0)}%`
                : null
            }
          />
          <Row
            label="Withdrawal rate"
            value={
              site.queue_withdrawal_rate != null
                ? `${(site.queue_withdrawal_rate * 100).toFixed(0)}%`
                : null
            }
          />
        </Card>

        <Card title="Connectivity">
          <Row label="Nearest IXP" value={site.nearest_ixp_name} />
          <Row label="IXP distance" value={km2mi(site.nearest_ixp_distance_km)} />
          <Row
            label="Fiber providers"
            value={site.fcc_fiber_providers != null ? fmtInt(site.fcc_fiber_providers) : null}
          />
          <Row
            label="Fiber coverage"
            value={site.fcc_fiber_pct != null ? `${site.fcc_fiber_pct.toFixed(1)}%` : null}
          />
          <Row
            label="Max download"
            value={site.fcc_max_down_mbps != null ? `${fmtInt(site.fcc_max_down_mbps)} Mbps` : null}
          />
          <Row label="Nearest cloud provider" value={site.nearest_cloud_provider} />
          <Row label="Nearest cloud region" value={site.nearest_cloud_region} />
          <Row
            label="Cloud region distance"
            value={km2mi(site.nearest_cloud_region_km ?? site.nearest_cloud_distance_km)}
          />
        </Card>

        <Card title="Site characteristics">
          <Row
            label="Site type"
            value={
              site.site_type ? (
                typeInfo ? (
                  <a href={`/site-types/${typeInfo.slug}`} className="text-purple-700 hover:underline">
                    {siteTypeLabel(site.site_type)}
                  </a>
                ) : (
                  siteTypeLabel(site.site_type)
                )
              ) : null
            }
          />
          <Row label="Acreage" value={site.acreage != null ? `${fmtInt(site.acreage)} ac` : null} />
          <Row label="Parcel owner" value={site.parcel_owner ? <OrgLink owner={site.parcel_owner} /> : null} />
          <Row label="Land contact" value={site.land_contact_name} />
          <Row label="Parcel APN" value={site.parcel_apn} />
          <Row label="Land owner type" value={site.land_owner_type} />
          <Row
            label="Buildability"
            value={site.buildability_score != null ? `${site.buildability_score.toFixed(1)}/100` : null}
          />
          <Row label="Land cover (NLCD)" value={site.nlcd_class} />
          {isBrownfield && (
            <>
              <Row label="Former use" value={site.former_use} />
              <Row
                label="Existing capacity"
                value={site.existing_capacity_mw != null ? fmtMwExact(site.existing_capacity_mw) : null}
              />
              <Row label="Cleanup status" value={site.cleanup_status} />
              <Row label="Retirement date" value={site.retirement_date} />
            </>
          )}
        </Card>

        <Card title="Risk & environment">
          <Row
            label="Flood zone"
            value={
              site.flood_zone ? (
                <span
                  className={
                    ["A", "AE", "AH", "AO", "V", "VE"].includes(site.flood_zone)
                      ? "text-red-600"
                      : "text-green-600"
                  }
                >
                  Zone {site.flood_zone}
                  {site.flood_zone_sfha ? " (SFHA)" : ""}
                </span>
              ) : null
            }
          />
          <Row
            label="Water stress (WRI)"
            value={
              site.wri_water_stress != null
                ? site.wri_water_stress.toFixed(2)
                : d?.water_stress_label ?? null
            }
          />
          <Row label="WRI basin" value={site.wri_basin_name} />
          <Row label="Wetlands (NWI)" value={<YesFlag v={site.wetland_present} />} />
          <Row label="Critical habitat" value={<YesFlag v={site.critical_habitat} bad />} />
          <Row label="Superfund nearby" value={<YesFlag v={site.superfund_nearby} bad />} />
          <Row label="Superfund site" value={site.superfund_site_name} />
          <Row
            label="Hazard sub-score"
            value={site.score_hazard != null ? `${Math.round(site.score_hazard)}/100` : null}
          />
          <Row
            label="Construction cost index"
            value={
              site.construction_cost_index != null
                ? `${site.construction_cost_index.toFixed(1)} (avg 100)`
                : null
            }
          />
        </Card>

        <Card title="Location context">
          <Row label="Nearest datacenter" value={site.nearest_dc_name} />
          <Row label="DC distance" value={km2mi(site.nearest_dc_distance_km)} />
          <Row label="Nearest rail" value={km2mi(site.nearest_rail_km)} />
          <Row label="Nearest gas pipeline" value={km2mi(site.nearest_gas_pipeline_km)} />
          <Row label="Nearest fiber route" value={km2mi(site.nearest_fiber_km)} />
          {d && (
            <>
              <Row
                label="County hazard (FEMA NRI)"
                value={d.nri_rating ? `${d.nri_rating}${d.nri_score != null ? ` (${d.nri_score})` : ""}` : null}
              />
              <Row
                label="DC tax incentive"
                value={
                  d.has_dc_tax_incentive == null
                    ? null
                    : d.has_dc_tax_incentive
                    ? `Yes${d.dc_incentive_type ? ` (${d.dc_incentive_type})` : ""}`
                    : "No"
                }
              />
              <Row label="Commercial electricity" value={fmtCents(d.avg_commercial_rate_cents_kwh)} />
              <Row label="Industrial electricity" value={fmtCents(d.avg_industrial_rate_cents_kwh)} />
              <Row
                label="Cooling degree days"
                value={d.cooling_degree_days != null ? fmtInt(d.cooling_degree_days) : null}
              />
              <Row
                label="Heating degree days"
                value={d.heating_degree_days != null ? fmtInt(d.heating_degree_days) : null}
              />
              <Row label="Land price / acre" value={fmtUsd(d.land_price_per_acre)} />
            </>
          )}
          <div className="mt-3">
            <a href={countyHref} className="text-sm font-medium text-purple-700 hover:underline">
              See all datacenter sites in {countyLabel} →
            </a>
          </div>
        </Card>
      </section>

      {d?.dc_incentive_details && (
        <p className="mt-4 rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm text-gray-700">
          <strong>Incentive detail:</strong> {d.dc_incentive_details}
        </p>
      )}

      {/* Location map — client island; profile data above stays server-rendered */}
      {site.latitude != null && site.longitude != null && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Site location</h2>
          <SiteMiniMap site={mapSite} nearby={mapNearby} height={380} />
        </section>
      )}

      {/* Full sub-score breakdown */}
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-bold text-gray-900">Full DC Readiness breakdown</h2>
        <p className="mb-3 text-xs text-gray-500">
          All 13 weighted sub-scores (0–100) behind the composite DC Readiness score.
        </p>
        <div>
          {SUBSCORES.map((sc) => (
            <ScoreBar
              key={sc.key}
              label={sc.label}
              weight={sc.weight}
              value={site[sc.key] as number | null}
            />
          ))}
        </div>
      </section>

      {/* Nearby comparable sites */}
      {nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold text-gray-900">
            Nearby comparable sites
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Other scored datacenter candidate sites
            {site.fips_code ? ` in ${countyLabel}` : " nearby"}, ranked by DC Readiness.
          </p>
          <div className="mt-3">
            <SitesTable
              sites={nearby}
              showCounty={!site.fips_code}
              caption={`Sites near ${name}`}
              linkBuilder={nearbyLink}
            />
          </div>
        </section>
      )}

      <div className="mt-8">
        <Freshness />
      </div>
      <p className="mt-2 max-w-3xl text-xs text-gray-400">
        Figures are screening estimates derived from public infrastructure data.
        Catalogued capacity reflects theoretical candidate capacity, not
        deliverable or committed interconnection. Confirm all values with the
        utility, ISO, and on-the-ground due diligence.
      </p>
      <UpgradeCTA context={`${name}, ${countyLabel}`} />
    </div>
  );
}
