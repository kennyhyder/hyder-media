import { createClient } from "@supabase/supabase-js";

// Closing-line snapshot cron. Runs every 15 min. For every bet that:
//   - has a sports_market_id (we can attribute it to a tracked market)
//   - has no closing_implied_prob yet
//   - was placed before the linked event's start_time
// We snapshot the market's last quote from ~5 min before start as the
// "closing line" and compute CLV = closing_implied_prob - line_implied_prob.
//
// CLV positive = line moved toward your side after you bet (you got the
// better number). Positive CLV is the #1 predictor of long-term profit
// independent of W/L variance.
//
// Source of truth for "closing line": median across all regulated books
// at T-5min, falling back to Kalshi if books are sparse.
//
// GET /api/sports/cron-capture-clv
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

import { isRegulatedUS } from "./_book_classification.js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const now = Date.now();

  // Find bets needing CLV snapshot: no closing_implied_prob, has a linked
  // sports_market_id, on a started event.
  const { data: bets, error } = await supabase
    .from("sb_bets")
    .select("id, user_id, sports_market_id, sports_event_id, line_implied_prob, placed_at")
    .is("closing_implied_prob", null)
    .not("sports_market_id", "is", null)
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  if (!bets?.length) return res.status(200).json({ skipped: "no bets needing CLV", started_at: startedAt });

  // Pull event start times in batch
  const eventIds = Array.from(new Set(bets.map((b) => b.sports_event_id).filter(Boolean)));
  const { data: events } = eventIds.length
    ? await supabase.from("sports_events").select("id, start_time, status").in("id", eventIds)
    : { data: [] };
  const eventById = new Map((events || []).map((e) => [e.id, e]));

  // Filter to bets where the event has started (within last 24h, not too old)
  const eligible = bets.filter((b) => {
    const ev = eventById.get(b.sports_event_id);
    if (!ev || !ev.start_time) return false;
    const startMs = new Date(ev.start_time).getTime();
    if (startMs > now) return false;                          // not started
    if (now - startMs > 24 * 3600 * 1000) return false;      // stale, give up
    return true;
  });
  if (!eligible.length) return res.status(200).json({ skipped: "no eligible bets", considered: bets.length, started_at: startedAt });

  const summary = { started_at: startedAt, considered: eligible.length, updated: 0, results: [] };

  for (const b of eligible) {
    const ev = eventById.get(b.sports_event_id);
    const startMs = new Date(ev.start_time).getTime();
    const targetWindowStart = new Date(startMs - 15 * 60 * 1000).toISOString();
    const targetWindowEnd = new Date(startMs + 5 * 60 * 1000).toISOString();

    // Pull all book quotes for this market in the closing window
    const { data: bookQuotes } = await supabase
      .from("sports_book_quotes")
      .select("book, implied_prob_novig, fetched_at")
      .eq("market_type", "h2h")
      .eq("sports_event_id", b.sports_event_id)
      .gte("fetched_at", targetWindowStart)
      .lte("fetched_at", targetWindowEnd)
      .order("fetched_at", { ascending: false })
      .limit(200);

    // Median across regulated books (latest per book)
    const latestByBook = new Map();
    for (const q of bookQuotes || []) {
      if (!isRegulatedUS(q.book)) continue;
      if (q.implied_prob_novig == null) continue;
      if (!latestByBook.has(q.book)) latestByBook.set(q.book, Number(q.implied_prob_novig));
    }
    const probs = Array.from(latestByBook.values()).sort((a, b) => a - b);
    let closing = null;
    let closingBook = null;
    if (probs.length >= 2) {
      closing = probs.length % 2 ? probs[(probs.length - 1) / 2] : (probs[probs.length / 2 - 1] + probs[probs.length / 2]) / 2;
      closingBook = "books_median";
    } else {
      // Fallback to Kalshi last quote in the window
      const { data: kalshi } = await supabase
        .from("sports_quotes")
        .select("implied_prob")
        .eq("market_id", b.sports_market_id)
        .gte("fetched_at", targetWindowStart)
        .lte("fetched_at", targetWindowEnd)
        .order("fetched_at", { ascending: false })
        .limit(1);
      if (kalshi?.[0]?.implied_prob != null) {
        closing = Number(kalshi[0].implied_prob);
        closingBook = "kalshi";
      }
    }
    if (closing == null) {
      summary.results.push({ id: b.id, skipped: "no closing-window data" });
      continue;
    }
    const clv = b.line_implied_prob != null ? closing - Number(b.line_implied_prob) : null;
    const { error: upErr } = await supabase
      .from("sb_bets")
      .update({
        closing_implied_prob: Number(closing.toFixed(5)),
        closing_book: closingBook,
        clv: clv != null ? Number(clv.toFixed(5)) : null,
      })
      .eq("id", b.id);
    if (upErr) {
      summary.results.push({ id: b.id, error: upErr.message });
    } else {
      summary.updated++;
      summary.results.push({ id: b.id, closing: closing.toFixed(4), clv: clv?.toFixed(4) });
    }
  }
  return res.status(200).json(summary);
}
