// Opportunity engine for the GridCensus autonomous SEO loop.
//
// Reads the last 28 days of gc_gsc_performance (aggregated per page+query),
// derives improvement opportunities, and persists them to gc_seo_opportunities.
// Dedupe key is (type, page, query); status is preserved across runs so a
// human/Claude "applied"/"dismissed" decision isn't clobbered by re-analysis.
//
// Everything is best-effort: a missing table or a query failure returns a zero
// result rather than throwing, so the cron stays green on an empty/new project.

import { getSupabase } from "@/lib/grid-api/db";

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Minimum 28-day impressions for a striking-distance / content-gap candidate. */
const MIN_IMPRESSIONS_STRIKING = 50;
/** Minimum impressions for a low-CTR candidate (need enough to trust the CTR). */
const MIN_IMPRESSIONS_LOW_CTR = 100;
/** Striking distance is positions 8-20: close enough to push into the top 5. */
const STRIKING_MIN_POS = 8;
const STRIKING_MAX_POS = 20;
/** Trailing window for rising/declining week-over-week comparison. */
const RECENT_DAYS = 7;

/**
 * Expected organic CTR by integer position (desktop+mobile blended, public
 * industry curves). Used to flag pages ranking well but under-earning clicks.
 */
const CTR_CURVE: Record<number, number> = {
  1: 0.28,
  2: 0.155,
  3: 0.1,
  4: 0.07,
  5: 0.05,
  6: 0.04,
  7: 0.032,
  8: 0.026,
  9: 0.022,
  10: 0.019,
};

function expectedCtr(position: number): number {
  const p = Math.max(1, Math.min(10, Math.round(position)));
  return CTR_CURVE[p] ?? 0.015;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PerfRow {
  page: string;
  query: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  position: number | null;
  date: string;
}

interface Agg {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  // impression-weighted average position
  posWeighted: number;
}

export type OpportunityType =
  | "striking_distance"
  | "low_ctr"
  | "content_gap"
  | "rising"
  | "declining";

interface OpportunityDraft {
  type: OpportunityType;
  page: string;
  query: string;
  priority: number;
  // Flat metric columns on gc_seo_opportunities.
  impressions: number;
  clicks: number;
  position: number;
  ctr: number;
  recommendation: Record<string, unknown>;
}

export interface OpportunityRunResult {
  ok: boolean;
  analyzed: number; // distinct page+query pairs considered
  upserted: number; // opportunities written
  byType: Record<string, number>;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A "hub/generic" page is a list/index page, not a dedicated entity profile. */
function isHubPage(page: string): boolean {
  let path = page;
  try {
    path = new URL(page).pathname;
  } catch {
    /* page may already be a path */
  }
  if (path === "/" || path === "") return true;
  const segs = path.split("/").filter(Boolean);
  if (segs.length <= 1) return true; // top-level section page
  // Entity profile pages end in a slug with a short-id (e.g. -ab12cd) or a known
  // deep structure (state/county/slug). Generic listing pages tend to be
  // /datacenter-sites, /rankings/<metric>, /iso/<region> -- shallow.
  const HUB_PREFIXES = [
    "rankings",
    "explore",
    "compare",
    "search",
    "map",
    "site-types",
    "market",
    "methodology",
  ];
  if (HUB_PREFIXES.includes(segs[0]) && segs.length <= 2) return true;
  return false;
}

function aggregate(rows: PerfRow[]): Agg[] {
  const map = new Map<string, { page: string; query: string; impr: number; clicks: number; posImpr: number }>();
  for (const r of rows) {
    const page = r.page || "";
    const query = r.query || "";
    if (!page || !query) continue;
    const impr = r.impressions ?? 0;
    const clicks = r.clicks ?? 0;
    const pos = r.position ?? 0;
    const key = `${page} ${query}`;
    const cur = map.get(key) ?? { page, query, impr: 0, clicks: 0, posImpr: 0 };
    cur.impr += impr;
    cur.clicks += clicks;
    cur.posImpr += pos * impr;
    map.set(key, cur);
  }
  const out: Agg[] = [];
  for (const v of map.values()) {
    out.push({
      page: v.page,
      query: v.query,
      impressions: v.impr,
      clicks: v.clicks,
      posWeighted: v.impr > 0 ? v.posImpr / v.impr : 0,
    });
  }
  return out;
}

/** Sum impressions per page+query for a date sub-range (for WoW deltas). */
function imprByKey(rows: PerfRow[]): Map<string, { page: string; query: string; impr: number }> {
  const m = new Map<string, { page: string; query: string; impr: number }>();
  for (const r of rows) {
    const page = r.page || "";
    const query = r.query || "";
    if (!page || !query) continue;
    const key = `${page} ${query}`;
    const cur = m.get(key) ?? { page, query, impr: 0 };
    cur.impr += r.impressions ?? 0;
    m.set(key, cur);
  }
  return m;
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Analyze the last 28 days and upsert opportunities. Safe to call from the
 * pull cron. Returns a summary (never throws -- failures land in `.error`).
 */
export async function runOpportunityEngine(): Promise<OpportunityRunResult> {
  const empty: OpportunityRunResult = { ok: true, analyzed: 0, upserted: 0, byType: {} };
  let sb;
  try {
    sb = getSupabase();
  } catch (e) {
    return { ...empty, ok: false, error: (e as Error).message };
  }

  const now = new Date();
  const start28 = new Date(now);
  start28.setUTCDate(start28.getUTCDate() - 28);
  const startRecent = new Date(now);
  startRecent.setUTCDate(startRecent.getUTCDate() - RECENT_DAYS);
  const startPrev = new Date(now);
  startPrev.setUTCDate(startPrev.getUTCDate() - RECENT_DAYS * 2);

  // Pull 28d of performance. Page through Supabase's 1000-row default cap.
  const rows: PerfRow[] = [];
  try {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("gc_gsc_performance")
        .select("page,query,impressions,clicks,ctr,position,date")
        .gte("date", ymd(start28))
        .order("date", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) {
        // Missing table / not configured yet -- degrade to empty.
        return { ...empty, ok: true };
      }
      const batch = (data ?? []) as PerfRow[];
      rows.push(...batch);
      if (batch.length < PAGE || rows.length >= 200_000) break;
    }
  } catch (e) {
    return { ...empty, ok: false, error: (e as Error).message };
  }

  if (rows.length === 0) return { ...empty, ok: true };

  const agg = aggregate(rows);

  // Week-over-week impressions for rising/declining.
  const recentRows = rows.filter((r) => r.date >= ymd(startRecent));
  const prevRows = rows.filter((r) => r.date >= ymd(startPrev) && r.date < ymd(startRecent));
  const recentMap = imprByKey(recentRows);
  const prevMap = imprByKey(prevRows);

  const drafts: OpportunityDraft[] = [];

  for (const a of agg) {
    // striking_distance: avg position 8-20 + enough impressions.
    if (
      a.posWeighted >= STRIKING_MIN_POS &&
      a.posWeighted <= STRIKING_MAX_POS &&
      a.impressions >= MIN_IMPRESSIONS_STRIKING
    ) {
      drafts.push({
        type: "striking_distance",
        page: a.page,
        query: a.query,
        priority: a.impressions * (a.posWeighted - 5),
        impressions: a.impressions,
        clicks: a.clicks,
        position: round2(a.posWeighted),
        ctr: a.impressions > 0 ? round4(a.clicks / a.impressions) : 0,
        recommendation: {
          action: "optimize title/meta to reach top 5",
          query: a.query,
          current_position: round2(a.posWeighted),
          target_position: 5,
          note: "On the cusp of page 1 / top 5. A sharper title + meta description targeting this query can lift it into clickable territory.",
        },
      });
    }

    // low_ctr: position <= 10 but CTR well below the curve.
    if (a.posWeighted > 0 && a.posWeighted <= 10 && a.impressions >= MIN_IMPRESSIONS_LOW_CTR) {
      const exp = expectedCtr(a.posWeighted);
      const actual = a.impressions > 0 ? a.clicks / a.impressions : 0;
      // "well below" = under 50% of expected and a meaningful absolute gap.
      if (actual < exp * 0.5 && exp - actual > 0.01) {
        drafts.push({
          type: "low_ctr",
          page: a.page,
          query: a.query,
          // priority = impressions x the click gap we could recover.
          priority: a.impressions * (exp - actual),
          impressions: a.impressions,
          clicks: a.clicks,
          position: round2(a.posWeighted),
          ctr: round4(actual),
          recommendation: {
            action: "rewrite title/description",
            query: a.query,
            position: round2(a.posWeighted),
            actual_ctr: round4(actual),
            expected_ctr: round4(exp),
            note: "Ranks on page 1 but earns far fewer clicks than its position warrants -- the title/description aren't compelling for this query.",
          },
        });
      }
    }

    // content_gap: real impressions, best-ranking page is a hub/generic page.
    if (a.impressions >= MIN_IMPRESSIONS_STRIKING && isHubPage(a.page)) {
      drafts.push({
        type: "content_gap",
        page: a.page,
        query: a.query,
        priority: a.impressions * 1.0,
        impressions: a.impressions,
        clicks: a.clicks,
        position: round2(a.posWeighted),
        ctr: a.impressions > 0 ? round4(a.clicks / a.impressions) : 0,
        recommendation: {
          action: "create/strengthen a targeted page",
          query: a.query,
          ranking_page: a.page,
          note: "A generic/hub page is ranking for this query. A dedicated, entity-specific page targeting it would likely outrank the hub and capture more intent.",
        },
      });
    }
  }

  // rising / declining: week-over-week impression deltas (one per page+query).
  const keys = new Set<string>([...recentMap.keys(), ...prevMap.keys()]);
  for (const key of keys) {
    const rec = recentMap.get(key);
    const prev = prevMap.get(key);
    const page = rec?.page ?? prev?.page ?? "";
    const query = rec?.query ?? prev?.query ?? "";
    if (!page || !query) continue;
    const recImpr = rec?.impr ?? 0;
    const prevImpr = prev?.impr ?? 0;
    const delta = recImpr - prevImpr;
    const base = Math.max(prevImpr, 1);
    const pct = delta / base;

    // Only flag meaningful movement on non-trivial volume.
    if (Math.abs(delta) >= 30 && Math.abs(pct) >= 0.4 && Math.max(recImpr, prevImpr) >= 50) {
      const rising = delta > 0;
      drafts.push({
        type: rising ? "rising" : "declining",
        page,
        query,
        priority: Math.abs(delta),
        impressions: recImpr,
        clicks: 0,
        position: 0,
        ctr: 0,
        recommendation: {
          action: rising
            ? "capitalize on momentum -- strengthen this page while it's trending up"
            : "investigate decline -- refresh content / check rankings",
          query,
          impressions_recent: recImpr,
          impressions_prev: prevImpr,
          pct_change: round2(pct),
        },
      });
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  const byType: Record<string, number> = {};
  let upserted = 0;

  if (drafts.length === 0) return { ok: true, analyzed: agg.length, upserted, byType };

  // gc_seo_opportunities has NO unique constraint on (type,page,query) (only id
  // is unique), so PostgREST upsert can't dedupe. Read existing rows keyed by
  // (type,page,query) and UPDATE-or-INSERT manually. Status is preserved so an
  // applied/dismissed decision isn't clobbered.
  const existing = new Map<string, { id: string; status: string }>();
  try {
    const { data: ex } = await sb
      .from("gc_seo_opportunities")
      .select("id,type,page,query,status");
    for (const r of (ex ?? []) as Array<{ id: string; type: string; page: string; query: string; status: string }>) {
      existing.set(`${r.type} ${r.page} ${r.query}`, { id: r.id, status: r.status });
    }
  } catch {
    /* table empty/new - treat all as inserts */
  }

  const toInsert: Array<Record<string, unknown>> = [];

  for (const d of drafts) {
    const key = `${d.type} ${d.page} ${d.query}`;
    const row = {
      type: d.type,
      page: d.page,
      query: d.query,
      impressions: Math.round(d.impressions),
      clicks: Math.round(d.clicks),
      position: d.position,
      ctr: d.ctr,
      priority: round2(d.priority),
      recommendation: d.recommendation,
    };
    const prior = existing.get(key);
    if (prior) {
      const { error } = await sb.from("gc_seo_opportunities").update(row).eq("id", prior.id);
      if (!error) {
        upserted += 1;
        byType[d.type] = (byType[d.type] ?? 0) + 1;
      }
    } else {
      toInsert.push({ ...row, status: "open" });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await sb.from("gc_seo_opportunities").insert(chunk);
    if (error) {
      return { ok: false, analyzed: agg.length, upserted, byType, error: `insert failed: ${error.message}` };
    }
    upserted += chunk.length;
    for (const r of chunk) byType[r.type as string] = (byType[r.type as string] ?? 0) + 1;
  }

  return { ok: true, analyzed: agg.length, upserted, byType };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
