import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { STATES, SITE_TYPES, ISO_REGIONS, countySlug } from "@/lib/geo";
import { countiesForState, freshnessDate, countyRollup } from "@/lib/rollups";
import { METRIC_KEYS } from "@/lib/rankings";
import { allSitesForStateSitemap } from "@/lib/db";
import { siteSlug } from "@/lib/entity-slug";

const LAST = freshnessDate();
const N = STATES.length;

// Shard layout:
//   0            = static hubs + states + iso + types + rankings
//   1..N         = one per state — that state's county pages
//   N+1..2N      = one per state — that state's individual site profile URLs
//                  (≤ ~10k entries per state, under the 50k cap)
export async function generateSitemaps() {
  return [
    { id: 0 },
    ...STATES.map((_, i) => ({ id: i + 1 })),
    ...STATES.map((_, i) => ({ id: N + i + 1 })),
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
    out.push(entry("/methodology", "monthly", 0.5));
    out.push(entry("/pricing", "monthly", 0.5));

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
