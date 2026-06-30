// Typed accessors over the precomputed rollups.json aggregate file.
// rollups.json is the SOLE source of aggregate stats (PostgREST aggregates
// are disabled). Live REST is only for top-N lists + per-county detail.

import rollupsRaw from "@/data/rollups.json";

export interface Agg {
  count: number;
  avgScore: number;
  totalCapacityMw: number;
  avgQueueWaitYears: number;
  avgQueueDepth: number;
  byType: Record<string, number>;
  byIso: Record<string, number>;
  byState: Record<string, number>;
  avgSubScores: {
    power: number;
    speed: number;
    fiber: number;
    water: number;
    hazard: number;
  };
}

export interface CountyRollup {
  state: string;
  countyName: string;
  count: number;
  avgScore: number;
  totalCapacityMw: number;
  byType: Record<string, number>;
}

export interface Rollups {
  generatedAt: string;
  dataLastUpdated: string;
  totalSites: number;
  national: Agg;
  states: Record<string, Agg>;
  iso: Record<string, Agg>;
  siteTypes: Record<string, Agg>;
  voltageTiers: Record<string, number>;
  counties: Record<string, CountyRollup>;
}

export const rollups = rollupsRaw as unknown as Rollups;

export const national = rollups.national;

export function stateAgg(code: string): Agg | undefined {
  return rollups.states[code];
}

export function isoAgg(region: string): Agg | undefined {
  return rollups.iso[region];
}

export function siteTypeAgg(type: string): Agg | undefined {
  return rollups.siteTypes[type];
}

export function countyRollup(fips: string): CountyRollup | undefined {
  return rollups.counties[fips];
}

/** All counties (with FIPS) for a given 2-letter state code. */
export function countiesForState(stateCode: string): Array<CountyRollup & { fips: string }> {
  return Object.entries(rollups.counties)
    .filter(([, c]) => c.state === stateCode)
    .map(([fips, c]) => ({ fips, ...c }));
}

/** Counties with at least `min` sites — the indexable county set. */
export function indexableCounties(min = 5): Array<CountyRollup & { fips: string }> {
  return Object.entries(rollups.counties)
    .filter(([, c]) => c.count >= min)
    .map(([fips, c]) => ({ fips, ...c }));
}

/** Find a county by state code + county slug (built from countyName). */
export function findCountyBySlug(
  stateCode: string,
  slug: string,
  countySlugFn: (name: string) => string
): { fips: string; county: CountyRollup } | undefined {
  for (const [fips, c] of Object.entries(rollups.counties)) {
    if (c.state !== stateCode) continue;
    if (!c.countyName) continue;
    if (countySlugFn(c.countyName) === slug) return { fips, county: c };
  }
  return undefined;
}

/** ISO data-last-updated string for freshness stamps + schema dateModified. */
export function freshness(): string {
  return rollups.dataLastUpdated;
}

/** Just the YYYY-MM-DD date for sitemap lastModified. */
export function freshnessDate(): Date {
  return new Date(rollups.dataLastUpdated);
}
