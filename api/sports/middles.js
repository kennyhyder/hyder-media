import { createClient } from "@supabase/supabase-js";

// Live middles scanner. Returns spread/total markets where two books offer
// non-overlapping lines that create a "middle" zone where both legs win.
//
// Totals example: Book A has OVER 220.5, Book B has UNDER 222.5. If the
// final score lands at 221 or 222, both bets win. The middle width is 2
// points. If the final lands outside (220 and below, or 223 and above),
// exactly one wins → you lose the vig (~3-5%).
//
// Spreads example: Book A has Team_X +3.5, Book B has Team_Y +0.5. Both
// bets imply a margin somewhere in the middle. If actual margin lands at
// 1 or 2 or 3, both win.
//
// Devigging: middles are positive-EV at any width because the vig you pay
// when both legs miss is much less than the +100% payout when both hit.
// Conservative middles (width >= 2 points) are particularly valuable.
//
// GET /api/sports/middles?since_min=120&min_width=0.5

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Bucketing the "Other" books: middles surfaced from offshore-only pairs
// would name offshore. Keep regulated-US only.
import { isRegulatedUS } from "./_book_classification.js";

const HARD_MIN_WIDTH = 0.5;     // ignore pseudo-middles
const HARD_MIN_LEGS_AGREE_VIG = -0.20; // both legs at -120 or better implied prob combined drops middle EV — skip extreme
const STALE_MIN = 30;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  const supabase = getSupabase();
  const sinceMin = Math.min(Number(req.query?.since_min) || 60, 240);
  const minWidth = Math.max(Number(req.query?.min_width) || HARD_MIN_WIDTH, HARD_MIN_WIDTH);
  const since = new Date(Date.now() - sinceMin * 60_000).toISOString();
  const freshCutoff = Date.now() - STALE_MIN * 60_000;

  // Pull spreads + totals quotes
  const { data: quotes, error } = await supabase
    .from("sports_book_v_latest")
    .select("sports_event_id, league, contestant_label, contestant_norm, book, american, point, market_type, fetched_at")
    .in("market_type", ["spreads", "totals"])
    .gte("fetched_at", since)
    .range(0, 9999);
  if (error) return res.status(500).json({ error: error.message });

  // Pull events for titles + start times
  const eventIds = Array.from(new Set((quotes || []).map((q) => q.sports_event_id)));
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, league, title, slug, season_year, start_time, status, event_type")
    .in("id", eventIds)
    .eq("status", "open");
  const eventById = new Map((events || []).map((e) => [e.id, e]));

  // Drop stale + offshore + non-event quotes
  const fresh = (quotes || []).filter((q) => {
    if (!eventById.has(q.sports_event_id)) return false;
    if (!isRegulatedUS(q.book)) return false;
    if (q.point == null || q.american == null) return false;
    if (new Date(q.fetched_at).getTime() < freshCutoff) return false;
    return true;
  });

  // ---- Build totals middles ----
  // Group by (event_id, contestant_label-side ['Over'|'Under']) — list of {point, book, american}
  const totalsOver = new Map();  // event_id → [{point, book, american}]
  const totalsUnder = new Map();
  for (const q of fresh) {
    if (q.market_type !== "totals") continue;
    const side = q.contestant_label?.toLowerCase() === "over" ? "over" : "under";
    const target = side === "over" ? totalsOver : totalsUnder;
    if (!target.has(q.sports_event_id)) target.set(q.sports_event_id, []);
    target.get(q.sports_event_id).push({ point: Number(q.point), book: q.book, american: Number(q.american) });
  }
  const totalsMiddles = [];
  for (const [eventId, overs] of totalsOver) {
    const unders = totalsUnder.get(eventId) || [];
    for (const o of overs) {
      for (const u of unders) {
        // Middle exists when OVER point < UNDER point
        const width = u.point - o.point;
        if (width < minWidth) continue;
        if (o.book === u.book) continue;
        // Skip if same point (no middle — just regular -110 on both sides)
        totalsMiddles.push({
          kind: "total",
          event_id: eventId,
          event: eventById.get(eventId),
          width,
          over: o,
          under: u,
        });
      }
    }
  }

  // ---- Build spread middles ----
  // Spreads have one entry per contestant. A middle exists when the SUM of
  // both teams' point spreads at two different books is < 0 (negative sum
  // means the two lines bracket a possible margin range).
  // We group by event + look for cross-contestant cross-book pairings.
  const spreadsByEventContestant = new Map();   // event_id → contestant_norm → [{point, book, american}]
  for (const q of fresh) {
    if (q.market_type !== "spreads") continue;
    if (!spreadsByEventContestant.has(q.sports_event_id)) spreadsByEventContestant.set(q.sports_event_id, new Map());
    const inner = spreadsByEventContestant.get(q.sports_event_id);
    if (!inner.has(q.contestant_norm)) inner.set(q.contestant_norm, []);
    inner.get(q.contestant_norm).push({ point: Number(q.point), book: q.book, american: Number(q.american), label: q.contestant_label });
  }
  const spreadsMiddles = [];
  for (const [eventId, byContestant] of spreadsByEventContestant) {
    const contestants = Array.from(byContestant.entries());
    if (contestants.length !== 2) continue;
    const [[, listA], [, listB]] = contestants;
    for (const a of listA) {
      for (const b of listB) {
        // A team's spread + the OTHER team's spread sum to ~0 in standard
        // pricing. A middle exists when (-a.point) > b.point — i.e. you bet
        // Team A +X and Team B +Y where X + Y > 0 creates an actual middle.
        // Pricing convention: if A is +3.5, B is -3.5. We bet A +3.5 at Book 1
        // and B +0.5 at Book 2 → both win if margin is 1-3 points.
        const sum = a.point + b.point;
        if (sum <= 0) continue;
        if (sum < minWidth) continue;
        if (a.book === b.book) continue;
        spreadsMiddles.push({
          kind: "spread",
          event_id: eventId,
          event: eventById.get(eventId),
          width: sum,
          leg_a: { ...a },
          leg_b: { ...b },
        });
      }
    }
  }

  // Combine + rank by width DESC
  const combined = [...totalsMiddles, ...spreadsMiddles].sort((x, y) => y.width - x.width).slice(0, 200);

  return res.status(200).json({
    total_results: combined.length,
    totals_count: totalsMiddles.length,
    spreads_count: spreadsMiddles.length,
    min_width: minWidth,
    middles: combined,
  });
}
