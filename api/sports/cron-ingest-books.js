import { getSupabase, checkAuth, normalizeName } from "./_lib.js";
import {
  LEAGUE_TO_SPORT, fetchOddsApi, americanToProb, devigOutcomes,
  matchContestant, normalizeBookKey,
} from "./_books.js";

// Ingest H2H sportsbook lines for non-golf leagues from The Odds API.
// One Odds API call per league = 1 credit. Each call returns ALL upcoming events
// for that league with quotes from every US book. We:
//   1. fetch the JSON
//   2. for each event, match to our sports_events row by team names + commence_time
//   3. upsert into sports_book_events_map
//   4. devig per book and insert rows into sports_book_quotes
//
// Designed to be called from Vercel cron every 30 min. Credit usage is reported
// in the response so we can validate budget.
//
// Auth: pass `?secret=<CRON_SECRET>` or set Authorization: Bearer <secret>.

export const config = { maxDuration: 60 };

const LEAGUES = ["nba", "mlb", "nhl", "epl", "mls"];

// Window of acceptable time diff for matching odds-API event → kalshi event
const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000; // ±6 hours

async function ingestLeague(supabase, league) {
  const summary = {
    league,
    api_calls: 0,
    events_returned: 0,
    events_matched: 0,
    events_unmatched: [],
    quotes_inserted: 0,
    credit_remaining: null,
    credit_used: null,
  };

  // 1. Pull current Kalshi events for this league + their contestants
  const { data: kalshiEvents } = await supabase
    .from("sports_events")
    .select("id, title, start_time, kalshi_event_ticker")
    .eq("league", league)
    .eq("event_type", "game")
    .eq("status", "open");

  if (!kalshiEvents?.length) {
    summary.skipped = "no open game events";
    return summary;
  }

  const { data: kalshiContestants } = await supabase
    .from("sports_contestants")
    .select("id, name, normalized_name")
    .eq("league", league);

  const contestantNormToId = new Map(
    (kalshiContestants || []).map((c) => [c.normalized_name, c.id])
  );

  // Also: load all sports_markets for these events so we can map contestant_id → kalshi market_id for each event
  const { data: kalshiMarkets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_id, contestant_label")
    .in("event_id", kalshiEvents.map((e) => e.id))
    .eq("market_type", "winner");

  // contestant labels stored on kalshi_markets are the source of truth for our display
  const kalshiContestantLabelById = new Map(
    (kalshiMarkets || []).map((m) => [m.contestant_id, m.contestant_label])
  );

  // 2. Pull from The Odds API
  const sport = LEAGUE_TO_SPORT[league];
  let api;
  try {
    api = await fetchOddsApi(`/sports/${sport}/odds`, {
      regions: "us",
      markets: "h2h",
      oddsFormat: "american",
      dateFormat: "iso",
    });
    summary.api_calls = 1;
  } catch (e) {
    summary.error = e.message;
    return summary;
  }
  summary.credit_remaining = api.credits.remaining;
  summary.credit_used = api.credits.used;
  summary.events_returned = api.body.length;

  // 3. For each Odds API event, find the matching Kalshi event
  const newMapRows = [];
  const insertQuoteRows = [];
  const now = new Date().toISOString();

  for (const oaEvent of api.body) {
    const oaCommence = new Date(oaEvent.commence_time).getTime();
    const homeNorm = normalizeName(oaEvent.home_team);
    const awayNorm = normalizeName(oaEvent.away_team);

    const homeId = matchContestant(oaEvent.home_team, league, contestantNormToId);
    const awayId = matchContestant(oaEvent.away_team, league, contestantNormToId);

    // Find kalshi event where both teams appear in title AND commence_time is close
    const candidates = kalshiEvents.filter((ke) => {
      if (!ke.start_time) return true; // can't filter by time, accept all
      const dt = Math.abs(new Date(ke.start_time).getTime() - oaCommence);
      return dt <= MATCH_WINDOW_MS;
    });

    let matchedEvent = null;
    if (homeId && awayId) {
      const homeLabel = kalshiContestantLabelById.get(homeId);
      const awayLabel = kalshiContestantLabelById.get(awayId);
      if (homeLabel && awayLabel) {
        const hNorm = normalizeName(homeLabel);
        const aNorm = normalizeName(awayLabel);
        matchedEvent = candidates.find((ke) => {
          const t = normalizeName(ke.title || "");
          return t.includes(hNorm) && t.includes(aNorm);
        });
      }
    }

    if (!matchedEvent) {
      summary.events_unmatched.push({
        odds_api_id: oaEvent.id,
        home: oaEvent.home_team,
        away: oaEvent.away_team,
        commence: oaEvent.commence_time,
        home_resolved: !!homeId,
        away_resolved: !!awayId,
      });
      continue;
    }
    summary.events_matched++;

    newMapRows.push({
      league,
      sport_key: sport,
      odds_api_event_id: oaEvent.id,
      sports_event_id: matchedEvent.id,
      home_team: oaEvent.home_team,
      away_team: oaEvent.away_team,
      home_team_norm: homeNorm,
      away_team_norm: awayNorm,
      commence_time: oaEvent.commence_time,
      matched_at: now,
      last_seen_at: now,
    });

    // 4. Build quote rows. For each bookmaker, dedupe outcomes by team, devig within the book.
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
        const contestantId =
          normalizeName(o.name) === homeNorm ? homeId :
          normalizeName(o.name) === awayNorm ? awayId :
          matchContestant(o.name, league, contestantNormToId);
        if (!contestantId) continue;
        const label = kalshiContestantLabelById.get(contestantId) || o.name;

        insertQuoteRows.push({
          sports_event_id: matchedEvent.id,
          odds_api_event_id: oaEvent.id,
          league,
          contestant_label: label,
          contestant_norm: normalizeName(label),
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

  // 5. Upsert map rows (idempotent on odds_api_event_id) + insert quotes (always append)
  if (newMapRows.length) {
    const { error: mapErr } = await supabase
      .from("sports_book_events_map")
      .upsert(newMapRows, { onConflict: "odds_api_event_id" });
    if (mapErr) summary.map_error = mapErr.message;
  }

  // Insert in batches of 500 to keep payload small
  for (let i = 0; i < insertQuoteRows.length; i += 500) {
    const slice = insertQuoteRows.slice(i, i + 500);
    const { error } = await supabase.from("sports_book_quotes").insert(slice);
    if (error) { summary.quote_error = error.message; break; }
    summary.quotes_inserted += slice.length;
  }

  return summary;
}

export default async function handler(req, res) {
  // Allow ?secret= query param OR Authorization header
  const provided = req.query?.secret || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!checkAuth(req) && !req.query?.secret) {
    // checkAuth returns true if no CRON_SECRET set, otherwise tightens
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
    final_credit_remaining: results.findLast?.((r) => r.credit_remaining)?.credit_remaining || null,
    results,
  });
}
