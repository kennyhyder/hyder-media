import { getSupabase, normalizeName } from "./_lib.js";
import {
  LEAGUE_TO_SPORT, fetchOddsApi, americanToProb, devigOutcomes,
  softLabelMatch, normalizeBookKey, normalizeForMatch,
} from "./_books.js";

// Ingest H2H sportsbook lines for non-golf leagues from The Odds API.
// One Odds API call per league = 1 credit. The call returns every upcoming
// event for the league with quotes from every US book.
//
// Matching strategy: load all open Kalshi game events + their markets, then
// for each Odds API event find a Kalshi event whose two markets both softly
// match the home/away team names. Match heuristics handle abbreviations
// ("ANA Ducks" vs "Anaheim Ducks"), prefix ("Boston" vs "Boston Celtics"),
// and league-specific overrides for stubborn names.
//
// Auth: ?secret= query OR Authorization: Bearer.

export const config = { maxDuration: 60 };

const LEAGUES = ["nba", "mlb", "nhl", "epl", "mls"];
const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000; // ±6h

async function ingestLeague(supabase, league) {
  const summary = {
    league, api_calls: 0,
    events_returned: 0, events_matched: 0, events_unmatched: [],
    quotes_inserted: 0,
    credit_remaining: null, credit_used: null,
  };

  // 1. Load open Kalshi events for this league
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, title, start_time, kalshi_event_ticker")
    .eq("league", league)
    .eq("event_type", "game")
    .eq("status", "open");

  if (!events?.length) {
    summary.skipped = "no open game events";
    return summary;
  }

  // 2. Load all markets for those events. The market's contestant_label is the
  // string we'll join book quotes to at read time.
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_label")
    .in("event_id", events.map((e) => e.id))
    .eq("market_type", "winner");

  // event_id → [{market_id, label, label_norm}]
  const marketsByEvent = new Map();
  for (const m of markets || []) {
    const arr = marketsByEvent.get(m.event_id) || [];
    arr.push({
      market_id: m.id,
      label: m.contestant_label,
      label_norm: normalizeForMatch(m.contestant_label),
    });
    marketsByEvent.set(m.event_id, arr);
  }

  // 3. Pull lines from Odds API
  const sport = LEAGUE_TO_SPORT[league];
  let api;
  try {
    api = await fetchOddsApi(`/sports/${sport}/odds`, {
      regions: "us", markets: "h2h",
      oddsFormat: "american", dateFormat: "iso",
    });
    summary.api_calls = 1;
  } catch (e) {
    summary.error = e.message;
    return summary;
  }
  summary.credit_remaining = api.credits.remaining;
  summary.credit_used = api.credits.used;
  summary.events_returned = api.body.length;

  // 4. For each Odds API event, find the matching Kalshi event by team labels + time
  const newMapRows = [];
  const insertQuoteRows = [];
  const now = new Date().toISOString();

  for (const oaEvent of api.body) {
    const oaCommence = new Date(oaEvent.commence_time).getTime();
    const home = oaEvent.home_team;
    const away = oaEvent.away_team;

    const timeCandidates = events.filter((e) => {
      if (!e.start_time) return true;
      return Math.abs(new Date(e.start_time).getTime() - oaCommence) <= MATCH_WINDOW_MS;
    });

    let matched = null;        // the Kalshi event
    let homeMarket = null;     // matched market for home team
    let awayMarket = null;     // matched market for away team

    for (const cand of timeCandidates) {
      const mkts = marketsByEvent.get(cand.id) || [];
      if (mkts.length < 2) continue;
      const h = mkts.find((m) => softLabelMatch(home, m.label, league));
      const a = mkts.find((m) => softLabelMatch(away, m.label, league));
      if (h && a && h.market_id !== a.market_id) {
        matched = cand;
        homeMarket = h;
        awayMarket = a;
        break;
      }
    }

    if (!matched) {
      summary.events_unmatched.push({
        odds_api_id: oaEvent.id,
        home, away, commence: oaEvent.commence_time,
      });
      continue;
    }
    summary.events_matched++;

    newMapRows.push({
      league, sport_key: sport,
      odds_api_event_id: oaEvent.id,
      sports_event_id: matched.id,
      home_team: home, away_team: away,
      home_team_norm: normalizeName(home),
      away_team_norm: normalizeName(away),
      commence_time: oaEvent.commence_time,
      matched_at: now, last_seen_at: now,
    });

    // 5. Quotes: for each bookmaker, de-vig the H2H outcomes
    for (const bm of oaEvent.bookmakers || []) {
      const h2h = (bm.markets || []).find((m) => m.key === "h2h");
      if (!h2h || !h2h.outcomes?.length) continue;
      const outcomes = h2h.outcomes.map((o) => ({
        name: o.name,
        american: Math.round(Number(o.price)),
        prob_raw: americanToProb(o.price),
      }));
      const devigged = devigOutcomes(outcomes);
      const bookNorm = normalizeBookKey(bm.key);

      for (const o of devigged) {
        // Which Kalshi market does this outcome belong to?
        let target;
        if (softLabelMatch(o.name, homeMarket.label, league)) target = homeMarket;
        else if (softLabelMatch(o.name, awayMarket.label, league)) target = awayMarket;
        // Soccer 3-way moneyline includes "Draw" — skip (no Kalshi market for it
        // by default; we could later store it under contestant_label='Tie')
        if (!target) continue;

        insertQuoteRows.push({
          sports_event_id: matched.id,
          odds_api_event_id: oaEvent.id,
          league,
          contestant_label: target.label,
          contestant_norm: target.label_norm,
          market_type: "h2h",
          book: bookNorm,
          american: o.american,
          implied_prob_raw: o.prob_raw,
          implied_prob_novig: o.prob_novig,
          fetched_at: now,
        });
      }
    }
  }

  // 6. Persist
  if (newMapRows.length) {
    const { error: mapErr } = await supabase
      .from("sports_book_events_map")
      .upsert(newMapRows, { onConflict: "odds_api_event_id" });
    if (mapErr) summary.map_error = mapErr.message;
  }

  for (let i = 0; i < insertQuoteRows.length; i += 500) {
    const slice = insertQuoteRows.slice(i, i + 500);
    const { error } = await supabase.from("sports_book_quotes").insert(slice);
    if (error) { summary.quote_error = error.message; break; }
    summary.quotes_inserted += slice.length;
  }

  return summary;
}

export default async function handler(req, res) {
  const provided = req.query?.secret || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const onlyLeague = req.query?.league;
  const targets = onlyLeague ? [onlyLeague] : LEAGUES;

  const started = Date.now();
  const supabase = getSupabase();
  const results = [];
  for (const lg of targets) {
    if (!LEAGUE_TO_SPORT[lg]) continue;
    try {
      results.push(await ingestLeague(supabase, lg));
    } catch (e) {
      results.push({ league: lg, fatal: e.message });
    }
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - started,
    total_credits_used_this_run: results.reduce((s, r) => s + (r.api_calls || 0), 0),
    final_credit_remaining: results.map((r) => r.credit_remaining).filter(Boolean).pop() || null,
    results,
  });
}
