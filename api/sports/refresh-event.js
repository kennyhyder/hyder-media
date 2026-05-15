import { getSupabase, normalizeName } from "./_lib.js";
import {
  LEAGUE_TO_SPORT, fetchOddsApi, americanToProb, devigOutcomes,
  softLabelMatch, normalizeBookKey, normalizeForMatch,
} from "./_books.js";

// Per-event Odds API refresh. Bypasses the 30-min cron schedule by calling
// the Odds API endpoint scoped to a single event_id. Auth via CRON_SECRET
// (so only the sportsbookish refresh proxy + our own crons can hit it).
//
// GET /api/sports/refresh-event?event_id=<sports_events.id>&secret=<CRON_SECRET>
//
// Returns:
//   { ok: true, credits_used: N, events_matched: 1, quotes_inserted: M }
//   { ok: false, reason: "..." }

export const config = { maxDuration: 30 };

function checkAuth(req) {
  const provided = req.query?.secret || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET) return true;
  return provided === process.env.CRON_SECRET;
}

function groupByPoint(outcomes) {
  const byPoint = new Map();
  for (const o of outcomes) {
    const k = String(o.point);
    if (!byPoint.has(k)) byPoint.set(k, []);
    byPoint.get(k).push(o);
  }
  return Array.from(byPoint.values()).filter((g) => g.length === 2);
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const sportsEventId = req.query.event_id;
  if (!sportsEventId) return res.status(400).json({ error: "event_id required" });

  const supabase = getSupabase();

  // 1. Load the event + its markets
  const { data: event } = await supabase
    .from("sports_events")
    .select("id, league, title, start_time, status, kalshi_event_ticker")
    .eq("id", sportsEventId)
    .maybeSingle();
  if (!event) return res.status(404).json({ error: "event not found" });

  const sport = LEAGUE_TO_SPORT[event.league];
  if (!sport) return res.status(400).json({ error: `league ${event.league} not Odds-API-supported` });

  // 2. Find the matching Odds API event id from our map table (saved at last
  // cron tick); fall back to a fresh league-wide /sports/{sport}/events lookup
  // if we don't have one yet.
  const { data: mapRow } = await supabase
    .from("sports_book_events_map")
    .select("odds_api_event_id")
    .eq("sports_event_id", sportsEventId)
    .maybeSingle();

  let oddsApiEventId = mapRow?.odds_api_event_id;
  let creditsUsed = 0;

  if (!oddsApiEventId) {
    // Discover from Odds API events index — 1 credit
    let listing;
    try {
      listing = await fetchOddsApi(`/sports/${sport}/events`, {
        dateFormat: "iso",
      });
      creditsUsed += 1;
    } catch (e) {
      return res.status(502).json({ error: `odds api events lookup: ${e.message}` });
    }
    // Match by team names + commence_time
    const { data: markets } = await supabase
      .from("sports_markets")
      .select("contestant_label")
      .eq("event_id", sportsEventId)
      .eq("market_type", "winner");
    const labels = (markets || []).map((m) => m.contestant_label);
    const cand = (listing.body || []).find((e) => {
      const homeMatch = labels.some((l) => softLabelMatch(e.home_team, l, event.league));
      const awayMatch = labels.some((l) => softLabelMatch(e.away_team, l, event.league));
      return homeMatch && awayMatch;
    });
    if (cand) oddsApiEventId = cand.id;
  }

  if (!oddsApiEventId) {
    return res.status(404).json({ error: "no Odds API event match for this game" });
  }

  // 3. Fetch the single-event odds with h2h + spreads + totals (3 credits)
  let api;
  try {
    api = await fetchOddsApi(`/sports/${sport}/events/${oddsApiEventId}/odds`, {
      regions: "us", markets: "h2h,spreads,totals",
      oddsFormat: "american", dateFormat: "iso",
    });
    creditsUsed += 3;
  } catch (e) {
    return res.status(502).json({ ok: false, credits_used: creditsUsed, error: e.message });
  }

  const oaEvent = api.body;

  // 4. Load Kalshi markets for the event so we can match team names → market labels
  const { data: kMarkets } = await supabase
    .from("sports_markets")
    .select("id, contestant_label")
    .eq("event_id", sportsEventId)
    .eq("market_type", "winner");
  const homeMarket = (kMarkets || []).find((m) => softLabelMatch(oaEvent.home_team, m.contestant_label, event.league));
  const awayMarket = (kMarkets || []).find((m) => softLabelMatch(oaEvent.away_team, m.contestant_label, event.league));

  // 5. Walk each book's markets + insert quotes
  const insertQuoteRows = [];
  const now = new Date().toISOString();
  for (const bm of oaEvent.bookmakers || []) {
    const bookNorm = normalizeBookKey(bm.key);
    for (const market of bm.markets || []) {
      const key = market.key;
      if (!["h2h", "spreads", "totals"].includes(key)) continue;
      if (!market.outcomes?.length) continue;

      const grouped = key === "totals" ? groupByPoint(market.outcomes) : [market.outcomes];
      for (const group of grouped) {
        const outcomes = group.map((o) => ({
          name: o.name,
          point: o.point != null ? Number(o.point) : null,
          american: Math.round(Number(o.price)),
          prob_raw: americanToProb(o.price),
        }));
        const devigged = devigOutcomes(outcomes);
        for (const o of devigged) {
          let label, labelNorm;
          if (key === "totals") {
            label = o.name;
            labelNorm = normalizeName(o.name);
          } else {
            const targetIsHome = homeMarket && softLabelMatch(o.name, homeMarket.contestant_label, event.league);
            const targetIsAway = awayMarket && softLabelMatch(o.name, awayMarket.contestant_label, event.league);
            if (!targetIsHome && !targetIsAway) continue;
            const target = targetIsHome ? homeMarket : awayMarket;
            label = target.contestant_label;
            labelNorm = normalizeForMatch(label);
          }
          insertQuoteRows.push({
            sports_event_id: sportsEventId,
            odds_api_event_id: oddsApiEventId,
            league: event.league,
            contestant_label: label,
            contestant_norm: labelNorm,
            market_type: key,
            book: bookNorm,
            point: o.point,
            american: o.american,
            implied_prob_raw: o.prob_raw,
            implied_prob_novig: o.prob_novig,
            fetched_at: now,
          });
        }
      }
    }
  }

  // 6. Persist
  let inserted = 0;
  for (let i = 0; i < insertQuoteRows.length; i += 500) {
    const slice = insertQuoteRows.slice(i, i + 500);
    const { error } = await supabase.from("sports_book_quotes").insert(slice);
    if (error) return res.status(500).json({ ok: false, credits_used: creditsUsed, error: error.message });
    inserted += slice.length;
  }

  // 7. Update map table's last_seen_at
  await supabase
    .from("sports_book_events_map")
    .upsert({
      odds_api_event_id: oddsApiEventId,
      sports_event_id: sportsEventId,
      league: event.league,
      sport_key: sport,
      home_team: oaEvent.home_team,
      away_team: oaEvent.away_team,
      home_team_norm: normalizeName(oaEvent.home_team),
      away_team_norm: normalizeName(oaEvent.away_team),
      commence_time: oaEvent.commence_time || null,
      last_seen_at: now,
    }, { onConflict: "odds_api_event_id" });

  return res.status(200).json({
    ok: true,
    credits_used: creditsUsed,
    credits_remaining: api.credits.remaining,
    quotes_inserted: inserted,
  });
}
