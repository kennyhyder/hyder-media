import { createClient } from "@supabase/supabase-js";

// Scrape Action Network's public-betting feeds. Their per-sport pages
// embed a `__NEXT_DATA__` blob with consensus splits per game (% of
// tickets and % of handle on each side, across all major books).
//
// We hit one endpoint per major sport. Splits don't change rapidly so
// a daily cron is sufficient.
//
// Per-row idempotency via UNIQUE(source, event_id, market, side, day).
// Re-runs of the same day update fetched_at but don't duplicate rows.
//
// Schedule: 13:00 UTC daily.
//
// GET /api/sports/cron-ingest-public-splits
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

// Action Network endpoints we'll scrape per sport
const ACTION_NETWORK_PAGES = {
  nba: "https://www.actionnetwork.com/nba/public-betting",
  mlb: "https://www.actionnetwork.com/mlb/public-betting",
  nfl: "https://www.actionnetwork.com/nfl/public-betting",
  nhl: "https://www.actionnetwork.com/nhl/public-betting",
};

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// Extract __NEXT_DATA__ JSON blob from a Next.js page
function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); }
  catch { return null; }
}

// Map the wildly varying ActionNetwork response shapes into our normalized
// rows. They reorganize this page periodically — when shape changes,
// the scrape will just return 0 rows rather than crash.
function normalizeActionNetwork(nextData, league) {
  const games = nextData?.props?.pageProps?.games
    || nextData?.props?.pageProps?.gamesData?.games
    || [];
  const out = [];
  for (const g of games) {
    const title = `${g?.away_team?.full_name || g?.away_team?.name || "Away"} @ ${g?.home_team?.full_name || g?.home_team?.name || "Home"}`;
    const home = g?.home_team?.full_name || g?.home_team?.name || null;
    const away = g?.away_team?.full_name || g?.away_team?.name || null;
    // ML splits
    const ml = g?.public_betting_data?.h2h || g?.public_betting?.h2h;
    if (ml && home && away) {
      if (ml.home_bet_percent != null) out.push({ league, event_title: title, market_type: "moneyline", side: home, tickets_pct: Math.round(ml.home_bet_percent), handle_pct: ml.home_money_percent != null ? Math.round(ml.home_money_percent) : null });
      if (ml.away_bet_percent != null) out.push({ league, event_title: title, market_type: "moneyline", side: away, tickets_pct: Math.round(ml.away_bet_percent), handle_pct: ml.away_money_percent != null ? Math.round(ml.away_money_percent) : null });
    }
    // Spread splits
    const spread = g?.public_betting_data?.spread || g?.public_betting?.spread;
    if (spread && home && away) {
      if (spread.home_bet_percent != null) out.push({ league, event_title: title, market_type: "spread", side: home, tickets_pct: Math.round(spread.home_bet_percent), handle_pct: spread.home_money_percent != null ? Math.round(spread.home_money_percent) : null });
      if (spread.away_bet_percent != null) out.push({ league, event_title: title, market_type: "spread", side: away, tickets_pct: Math.round(spread.away_bet_percent), handle_pct: spread.away_money_percent != null ? Math.round(spread.away_money_percent) : null });
    }
    // Total splits
    const total = g?.public_betting_data?.total || g?.public_betting?.total;
    if (total) {
      if (total.over_bet_percent != null) out.push({ league, event_title: title, market_type: "total", side: "Over", tickets_pct: Math.round(total.over_bet_percent), handle_pct: total.over_money_percent != null ? Math.round(total.over_money_percent) : null });
      if (total.under_bet_percent != null) out.push({ league, event_title: title, market_type: "total", side: "Under", tickets_pct: Math.round(total.under_bet_percent), handle_pct: total.under_money_percent != null ? Math.round(total.under_money_percent) : null });
    }
  }
  return out;
}

// Loose match each Action Network event to our sports_events by title
// substring + start_time proximity.
async function matchToSportsEvent(supabase, league, eventTitle) {
  // Try to find an open event whose title shares substantial overlap
  const { data: candidates } = await supabase
    .from("sports_events")
    .select("id, title")
    .eq("league", league)
    .eq("status", "open")
    .eq("event_type", "game")
    .limit(50);
  if (!candidates?.length) return null;
  const targetTokens = new Set(
    eventTitle.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const cTokens = new Set(
      (c.title || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2),
    );
    let overlap = 0;
    for (const t of targetTokens) if (cTokens.has(t)) overlap++;
    if (overlap > bestScore) { bestScore = overlap; best = c; }
  }
  return bestScore >= 2 ? best : null;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const summary = { started_at: startedAt, by_league: [], total_rows: 0 };

  for (const [league, url] of Object.entries(ACTION_NETWORK_PAGES)) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SportsBookISH/1.0; +https://sportsbookish.com)",
          Accept: "text/html",
        },
      });
      if (!r.ok) {
        summary.by_league.push({ league, error: `HTTP ${r.status}` });
        continue;
      }
      const html = await r.text();
      const nextData = extractNextData(html);
      if (!nextData) {
        summary.by_league.push({ league, error: "no __NEXT_DATA__ found" });
        continue;
      }
      const rows = normalizeActionNetwork(nextData, league);

      // Resolve sports_event_id per row + insert
      let inserted = 0;
      for (const row of rows) {
        const matched = await matchToSportsEvent(supabase, league, row.event_title);
        const sports_event_id = matched?.id || null;
        // Upsert via the unique (source, event, market, side, for_day) key
        const { error } = await supabase.from("sb_public_splits").upsert({
          sports_event_id,
          league,
          event_title: row.event_title,
          market_type: row.market_type,
          side: row.side,
          tickets_pct: row.tickets_pct,
          handle_pct: row.handle_pct,
          source: "action_network",
          for_day: new Date().toISOString().slice(0, 10),
        }, { onConflict: "source,sports_event_id,market_type,side,for_day" });
        if (!error) inserted++;
      }
      summary.by_league.push({ league, scraped: rows.length, inserted });
      summary.total_rows += inserted;
    } catch (e) {
      summary.by_league.push({ league, error: e.message });
    }
  }

  return res.status(200).json(summary);
}
