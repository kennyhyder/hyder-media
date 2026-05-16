import { getSupabase, checkAuth } from "./_lib.js";

// Sweep events that have past their start_time + grace period and capture
// their final state into sports_event_archive. The archived rows preserve
// the closing Kalshi/books prices forever so the slug route stays useful
// for historical SEO traffic ("Lakers vs Celtics 2024 Finals odds").
//
// Cron schedule (suggested in vercel.json): hourly.
//
// GET /api/sports/cron-archive-events
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

// How long after start_time do we wait before archiving? Games last 2-4 hours;
// playoff series can span weeks; futures resolve at season end. Per event_type:
const ARCHIVE_DELAY_HOURS = {
  game: 4,             // MLB/NBA/NHL/NFL games are 3-4h; archive shortly after.
                       // Was 12h, which left settled morning games showing as
                       // open all day with dust-quote 99/1¢ prices feeding
                       // phantom edges into the league pages.
  series: 24 * 21,     // ~3 weeks for a playoff series
  championship: 24 * 7,
  conference: 24 * 7,
  division: 24 * 7,
  playoffs: 24 * 7,
  record_best: 24 * 7,
  record_worst: 24 * 7,
  win_total: 24 * 7,
  mvp: 24 * 7,
  award: 24 * 7,
  trade: 24 * 30,
};

async function snapshotEvent(supabase, evt) {
  // Pull latest market state + Kalshi quote per market + book consensus
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label, market_type")
    .eq("event_id", evt.id);

  const marketIds = (markets || []).map((m) => m.id);
  if (!marketIds.length) return null;

  const { data: kalshi } = await supabase
    .from("sports_quotes_latest")
    .select("market_id, implied_prob, yes_bid, yes_ask, last_price, fetched_at")
    .in("market_id", marketIds);
  const kBy = new Map((kalshi || []).map((k) => [k.market_id, k]));

  const { data: books } = await supabase
    .from("sports_book_quotes")
    .select("contestant_label, contestant_norm, market_type, book, american, implied_prob_novig, fetched_at")
    .eq("sports_event_id", evt.id)
    .order("fetched_at", { ascending: false });

  // Most-recent-per (norm, book, market_type)
  const seen = new Set();
  const latestBooks = [];
  for (const b of books || []) {
    const k = `${b.contestant_norm}|${b.book}|${b.market_type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    latestBooks.push(b);
  }

  return {
    title: evt.title,
    event_type: evt.event_type,
    start_time: evt.start_time,
    kalshi_event_ticker: evt.kalshi_event_ticker,
    markets: (markets || []).map((m) => {
      const k = kBy.get(m.id);
      const mb = latestBooks.filter((b) => b.contestant_label === m.contestant_label && b.market_type === "h2h");
      const novigs = mb.map((b) => b.implied_prob_novig).filter((v) => v != null).sort((a, b) => a - b);
      const median = novigs.length
        ? (novigs.length % 2 ? novigs[Math.floor(novigs.length / 2)] : (novigs[novigs.length / 2 - 1] + novigs[novigs.length / 2]) / 2)
        : null;
      return {
        market_id: m.id,
        contestant_label: m.contestant_label,
        market_type: m.market_type,
        kalshi: k ? {
          implied_prob: k.implied_prob,
          yes_bid: k.yes_bid, yes_ask: k.yes_ask, last_price: k.last_price,
          fetched_at: k.fetched_at,
        } : null,
        books: {
          count: mb.length,
          median: median != null ? Number(median.toFixed(4)) : null,
          per_book: mb.map((b) => ({ book: b.book, american: b.american, novig: b.implied_prob_novig })),
        },
      };
    }),
  };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const summary = { scanned: 0, archived: 0, errors: [] };
  const now = Date.now();

  // Pull every open event with a known start_time
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, league, title, event_type, start_time, kalshi_event_ticker, status, slug")
    .eq("status", "open")
    .not("start_time", "is", null);
  summary.scanned = events?.length || 0;

  for (const evt of events || []) {
    const delay = ARCHIVE_DELAY_HOURS[evt.event_type] ?? 48;
    const startMs = new Date(evt.start_time).getTime();
    if (now - startMs < delay * 3600 * 1000) continue;  // not yet eligible

    try {
      const snap = await snapshotEvent(supabase, evt);
      if (!snap || !snap.markets?.length) {
        summary.errors.push({ id: evt.id, reason: "no markets to snapshot" });
        continue;
      }

      const { error: archiveErr } = await supabase
        .from("sports_event_archive")
        .upsert({
          sports_event_id: evt.id,
          final_snapshot: snap,
          closed_at: new Date().toISOString(),
        }, { onConflict: "sports_event_id" });
      if (archiveErr) { summary.errors.push({ id: evt.id, reason: archiveErr.message }); continue; }

      const { error: evtErr } = await supabase
        .from("sports_events")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", evt.id);
      if (evtErr) { summary.errors.push({ id: evt.id, reason: evtErr.message }); continue; }

      summary.archived++;
    } catch (e) {
      summary.errors.push({ id: evt.id, reason: e.message });
    }
  }

  return res.status(200).json(summary);
}
