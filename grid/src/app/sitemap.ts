import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { STATES, SITE_TYPES, ISO_REGIONS, stateByCode, countySlug } from "@/lib/geo";
import { countiesForState, freshnessDate, countyRollup } from "@/lib/rollups";
import { METRIC_KEYS } from "@/lib/rankings";
import {
  allSitesForStateSitemap,
  allSubstationsForStateSitemap,
  allBrownfieldsForSitemap,
  allIxpsForSitemap,
  allDatacentersForSitemap,
} from "@/lib/db";
import {
  siteSlug,
  substationSlug,
  brownfieldSlug,
  ixpSlug,
  datacenterSlug,
} from "@/lib/entity-slug";
import { getCompanies } from "@/lib/companies";

const LAST = freshnessDate();
const N = STATES.length;

// Shard layout (keep sitemap-index.xml shard count in sync):
//   0            = static hubs + states + iso + types + rankings + entity hubs
//   1..N         = one per state — that state's county pages
//   N+1..2N      = one per state — that state's individual site profile URLs
//   2N+1..3N     = one per state — that state's substation profile URLs
//   3N+1         = all brownfield-site profile URLs (~2k)
//   3N+2         = all internet-exchange profile URLs (~1.4k)
//   3N+3         = all datacenter profile URLs (~3.7k)
//   3N+4         = all operating-company profile URLs (few hundred)
const BROWNFIELD_SHARD = 3 * N + 1;
const IXP_SHARD = 3 * N + 2;
const DATACENTER_SHARD = 3 * N + 3;
const COMPANY_SHARD = 3 * N + 4;

export async function generateSitemaps() {
  return [
    { id: 0 },
    ...STATES.map((_, i) => ({ id: i + 1 })),
    ...STATES.map((_, i) => ({ id: N + i + 1 })),
    ...STATES.map((_, i) => ({ id: 2 * N + i + 1 })),
    { id: BROWNFIELD_SHARD },
    { id: IXP_SHARD },
    { id: DATACENTER_SHARD },
    { id: COMPANY_SHARD },
  ];
}

function entry(
  path: string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number
): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}${path}`,
    lastModified: LAST,
    changeFrequency,
    priority,
  };
}

export default async function sitemap({
  id: idInput,
}: {
  // Next 16 passes `id` as a Promise resolving to the shard id string.
  id: number | string | Promise<number | string>;
}): Promise<MetadataRoute.Sitemap> {
  const resolved = await idInput;
  const id =
    typeof resolved === "string" ? parseInt(resolved, 10) : resolved;
  if (id === 0) {
    const out: MetadataRoute.Sitemap = [];
    // Static hubs
    out.push(entry("/", "daily", 1.0));
    out.push(entry("/datacenter-sites", "weekly", 0.9));
    out.push(entry("/site-types", "weekly", 0.8));
    out.push(entry("/iso", "weekly", 0.8));
    out.push(entry("/rankings", "weekly", 0.9));
    out.push(entry("/substations", "weekly", 0.8));
    out.push(entry("/internet-exchanges", "weekly", 0.8));
    out.push(entry("/datacenters", "weekly", 0.8));
    out.push(entry("/companies", "weekly", 0.8));
    out.push(entry("/brownfield-sites", "weekly", 0.8));
    out.push(entry("/methodology", "monthly", 0.5));
    out.push(entry("/pricing", "monthly", 0.5));

    // Per-state entity index pages (substations + brownfields by state)
    for (const s of STATES) {
      out.push(entry(`/substations/${s.slug}`, "weekly", 0.6));
      out.push(entry(`/brownfield-sites/${s.slug}`, "weekly", 0.6));
    }

    // States
    for (const s of STATES) {
      out.push(entry(`/datacenter-sites/${s.slug}`, "weekly", 0.8));
    }
    // ISO regions
    for (const r of Object.values(ISO_REGIONS)) {
      out.push(entry(`/iso/${r.slug}`, "weekly", 0.7));
    }
    // Site types + type×state combos (>=5)
    for (const t of Object.values(SITE_TYPES)) {
      out.push(entry(`/site-types/${t.slug}`, "weekly", 0.7));
    }
    // Rankings
    for (const m of METRIC_KEYS) {
      out.push(entry(`/rankings/${m}`, "weekly", 0.7));
    }
    return out;
  }

  // County shards: id in 1..N → STATES[id-1]
  if (id >= 1 && id <= N) {
    const state = STATES[id - 1];
    if (!state) return [];
    const counties = countiesForState(state.code).filter(
      (c) => c.count >= 5 && !!c.countyName
    );
    return counties.map((c) =>
      entry(
        `/datacenter-sites/${state.slug}/${countySlug(c.countyName)}`,
        "weekly",
        0.6
      )
    );
  }

  // Site shards: id in N+1..2N → STATES[id-N-1], all that state's site profiles.
  if (id >= N + 1 && id <= 2 * N) {
    const state = STATES[id - N - 1];
    if (!state) return [];
    const rows = await allSitesForStateSitemap(state.code);
    const out: MetadataRoute.Sitemap = [];
    for (const row of rows) {
      // Mirror the page-level noindex gate: skip rows missing score or fips.
      if (row.dc_score == null || !row.fips_code) continue;
      const countyName = countyRollup(row.fips_code)?.countyName;
      if (!countyName) continue;
      const path = `/datacenter-sites/${state.slug}/${countySlug(countyName)}/${siteSlug(row)}`;
      out.push({
        url: `${SITE_URL}${path}`,
        lastModified: row.updated_at ? new Date(row.updated_at) : LAST,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
    return out;
  }

  // Substation shards: id in 2N+1..3N → STATES[id-2N-1].
  if (id >= 2 * N + 1 && id <= 3 * N) {
    const state = STATES[id - 2 * N - 1];
    if (!state) return [];
    const rows = await allSubstationsForStateSitemap(state.code);
    return rows
      .filter((row) => !!row.name && !/^UNKNOWN/i.test(row.name))
      .map((row) => ({
        url: `${SITE_URL}/substations/${state.slug}/${substationSlug(row)}`,
        lastModified: row.created_at ? new Date(row.created_at) : LAST,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
  }

  // Brownfield shard (single).
  if (id === BROWNFIELD_SHARD) {
    const rows = await allBrownfieldsForSitemap();
    return rows
      .filter((row) => !!row.name && !!row.state && !!stateByCode(row.state))
      .map((row) => ({
        url: `${SITE_URL}/brownfield-sites/${stateByCode(row.state!)!.slug}/${brownfieldSlug(row)}`,
        lastModified: row.created_at ? new Date(row.created_at) : LAST,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
  }

  // Internet-exchange shard (single).
  if (id === IXP_SHARD) {
    const rows = await allIxpsForSitemap();
    return rows
      .filter((row) => !!row.name)
      .map((row) => ({
        url: `${SITE_URL}/internet-exchanges/${ixpSlug(row)}`,
        lastModified: row.created_at ? new Date(row.created_at) : LAST,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
  }

  // Datacenter shard (single).
  if (id === DATACENTER_SHARD) {
    const rows = await allDatacentersForSitemap();
    return rows
      .filter((row) => !!row.name && !!row.state)
      .map((row) => ({
        url: `${SITE_URL}/datacenters/${datacenterSlug(row)}`,
        lastModified: row.created_at ? new Date(row.created_at) : LAST,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
  }

  // Company shard (single). Skip noindex (empty/unnamed) companies.
  if (id === COMPANY_SHARD) {
    const companies = await getCompanies();
    return companies
      .filter((c) => c.name && c.facilityCount >= 1)
      .map((c) => ({
        url: `${SITE_URL}/companies/${c.slug}`,
        lastModified: LAST,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
  }

  return [];
}
