// Curated AEO citation-magnet rankings, computed purely from rollups.json.
// Each metric ranks either states, ISO regions, or site types.

import { rollups, national, stateAgg, type Agg } from "./rollups";
import { STATES, slugify, siteTypeLabel, isoLabel, SITE_TYPES, ISO_REGIONS } from "./geo";

export interface RankedRow {
  /** Display name (state/iso/type). */
  name: string;
  /** Link target for the row, if any. */
  href?: string;
  /** Numeric metric used for sorting. */
  value: number;
  /** Pre-formatted display string for the metric. */
  display: string;
}

export type RankSubject = "state" | "iso" | "site-type";

export interface MetricDef {
  key: string;
  title: string;
  subject: RankSubject;
  /** Short narrative-intro template; {leader} / {value} substituted. */
  unit: string;
  description: string;
  compute: () => RankedRow[];
}

function fmtInt(n: number): string {
  return Intl.NumberFormat("en-US").format(Math.round(n));
}
function fmtScore(n: number): string {
  return n.toFixed(1);
}
function fmtMw(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M MW`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k MW`;
  return `${fmtInt(n)} MW`;
}
function fmtYears(n: number): string {
  return `${n.toFixed(1)} yrs`;
}

// Helper: build state rows from an accessor + formatter, then sort.
function stateRows(
  pick: (a: Agg) => number,
  fmt: (n: number) => string,
  dir: "desc" | "asc",
  minCount = 50
): RankedRow[] {
  const rows: RankedRow[] = [];
  for (const s of STATES) {
    const agg = stateAgg(s.code);
    if (!agg || agg.count < minCount) continue;
    const value = pick(agg);
    if (!Number.isFinite(value)) continue;
    rows.push({
      name: s.name,
      href: `/datacenter-sites/${s.slug}`,
      value,
      display: fmt(value),
    });
  }
  rows.sort((a, b) => (dir === "desc" ? b.value - a.value : a.value - b.value));
  return rows;
}

export const METRICS: MetricDef[] = [
  {
    key: "top-states-datacenter-readiness",
    title: "Top States by Datacenter Readiness",
    subject: "state",
    unit: "average DC Readiness score",
    description:
      "States ranked by the average GridCensus DC Readiness score across all catalogued candidate sites — a blended screen of power, speed-to-power, fiber, water, and hazard.",
    compute: () => stateRows((a) => a.avgScore, fmtScore, "desc"),
  },
  {
    key: "states-most-datacenter-sites",
    title: "States with the Most Datacenter Candidate Sites",
    subject: "state",
    unit: "catalogued candidate sites",
    description:
      "States ranked by the raw count of scored datacenter candidate sites in the GridCensus catalog.",
    compute: () => stateRows((a) => a.count, fmtInt, "desc", 0),
  },
  {
    key: "states-largest-candidate-capacity",
    title: "States by Largest Catalogued Candidate Capacity",
    subject: "state",
    unit: "catalogued candidate capacity",
    description:
      "States ranked by the sum of per-site available-capacity estimates — a theoretical aggregate of candidate megawatts, not deliverable power.",
    compute: () => stateRows((a) => a.totalCapacityMw, fmtMw, "desc", 0),
  },
  {
    key: "states-shortest-interconnection-queue",
    title: "States with the Shortest Interconnection Queue Wait",
    subject: "state",
    unit: "average queue wait",
    description:
      "States ranked by the shortest average interconnection-queue wait across their candidate sites — a key speed-to-power signal.",
    compute: () => stateRows((a) => a.avgQueueWaitYears, fmtYears, "asc"),
  },
  {
    key: "states-fastest-speed-to-power",
    title: "States by Fastest Speed-to-Power",
    subject: "state",
    unit: "average speed-to-power sub-score",
    description:
      "States ranked by the average speed-to-power sub-score — proximity to existing transmission, substation adjacency, and queue dynamics.",
    compute: () => stateRows((a) => a.avgSubScores.speed, fmtScore, "desc"),
  },
  {
    key: "states-lowest-water-stress",
    title: "States with the Lowest Water Stress for Cooling",
    subject: "state",
    unit: "average water sub-score",
    description:
      "States ranked by the average water sub-score (higher = lower water stress) — a proxy for cooling-water availability across candidate sites.",
    compute: () => stateRows((a) => a.avgSubScores.water, fmtScore, "desc"),
  },
  {
    key: "states-most-brownfield-sites",
    title: "States with the Most Brownfield Datacenter Sites",
    subject: "state",
    unit: "brownfield candidate sites",
    description:
      "States ranked by the number of brownfield candidate sites — previously developed parcels that trade remediation overhead for existing utility hookups and infill locations.",
    compute: () => {
      const rows: RankedRow[] = [];
      for (const s of STATES) {
        const agg = stateAgg(s.code);
        const n = agg?.byType?.brownfield ?? 0;
        if (n <= 0) continue;
        rows.push({
          name: s.name,
          href: `/site-types/brownfield/${s.slug}`,
          value: n,
          display: fmtInt(n),
        });
      }
      rows.sort((a, b) => b.value - a.value);
      return rows;
    },
  },
  {
    key: "iso-regions-by-queue-depth",
    title: "ISO/RTO Regions by Interconnection Queue Depth",
    subject: "iso",
    unit: "average queue depth",
    description:
      "Grid operators ranked by the average interconnection-queue depth at their candidate sites — deeper queues signal more contention for new load.",
    compute: () => {
      const rows: RankedRow[] = [];
      for (const r of Object.values(ISO_REGIONS)) {
        const agg = rollups.iso[r.key];
        if (!agg) continue;
        rows.push({
          name: `${r.label} (${r.fullName})`,
          href: `/iso/${r.slug}`,
          value: agg.avgQueueDepth,
          display: fmtInt(agg.avgQueueDepth),
        });
      }
      rows.sort((a, b) => b.value - a.value);
      return rows;
    },
  },
  {
    key: "site-types-by-readiness",
    title: "Datacenter Site Types Ranked by Readiness",
    subject: "site-type",
    unit: "average DC Readiness score",
    description:
      "The nine GridCensus site types ranked by their average DC Readiness score — which categories of land screen best for datacenter development.",
    compute: () => {
      const rows: RankedRow[] = [];
      for (const t of Object.values(SITE_TYPES)) {
        const agg = rollups.siteTypes[t.key];
        if (!agg) continue;
        rows.push({
          name: t.label,
          href: `/site-types/${t.slug}`,
          value: agg.avgScore,
          display: fmtScore(agg.avgScore),
        });
      }
      rows.sort((a, b) => b.value - a.value);
      return rows;
    },
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);

const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export function metricByKey(key: string): MetricDef | undefined {
  return METRIC_BY_KEY.get(key);
}

// Re-export tiny helpers used by ranking pages.
export { national, slugify, siteTypeLabel, isoLabel };
