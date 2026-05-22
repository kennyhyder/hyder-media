import { createClient } from "@supabase/supabase-js";
import {
  FUTURES_MARKETS, fetchOddsApi, americanToProb, devigOutcomes,
  softLabelMatch, normalizeForMatch,
} from "./_books.js";
import { normalizeName } from "./_lib.js";

// Sportsbook futures-odds ingester. Pulls /sports/{sport_key}/odds with
// markets=outrights for each entry in FUTURES_MARKETS, then matches every
// outright outcome to a contestant on an existing Kalshi
// championship/conference/MVP event in the same league.
//
// Stored as market_type='outrights' rows in sports_book_quotes so the read
// path can join non-game events (event_type IN (championship, conference,
// division, mvp, award, win_total, ...)) to book consensus alongside the
// existing h2h game lines.
//
// GET /api/sports/cron-ingest-books-futures
//   Authorization: Bearer <CRON_SECRET>
//
// Cost model: 1 Odds API credit per market × ~13 markets = ~13 credits per
// run. At hourly cadence that's ~9,360/month — leaves ample headroom in the
// 20K/mo budget (h2h-games at every 30 min uses ~21,600 — see ingester-books
// for the full math).

export const config = { maxDuration: 120 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function ingestOne(supabase, cfg) {
  const summary = { league: cfg.league, event_type: cfg.event_type, sport_key: cfg.sport_key, events_matched: 0, quotes: 0 };

  // Skip entries marked inactive (between seasons). Avoids 404s + wasted
  // API credits.
  if (cfg.active === false) { summary.skipped = "active=false (between seasons)"; return summary; }

  // 1. Pull the candidate Kalshi events (event_type matches, status=open)
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, title, kalshi_event_ticker")
    .eq("league", cfg.league)
    .eq("event_type", cfg.event_type)
    .eq("status", "open");
  if (!events?.length) { summary.skipped = `no open ${cfg.event_type} events for ${cfg.league}`; return summary; }

  // Markets for those events — contestant_label is what we match against
  const eventIds = events.map((e) => e.id);
  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_label")
    .in("event_id", eventIds)
    .eq("market_type", "winner");
  if (!markets?.length) { summary.skipped = "no winner markets to attach books to"; return summary; }

  // Index markets by (event_id, normalized_contestant_label)
  const marketByKey = new Map();
  for (const m of markets) {
    marketByKey.set(`${m.event_id}|${normalizeForMatch(m.contestant_label)}`, m.id);
  }

  // 2. Pull outrights from Odds API. 404 on inactive sport_keys is normal
  // (between seasons) — skip without raising errors.
  let api;
  try {
    api = await fetchOddsApi(`/sports/${cfg.sport_key}/odds`, {
      regions: "us", markets: "outrights",
      oddsFormat: "american", dateFormat: "iso",
    });
    summary.api_calls = 1;
    summary.credit_remaining = api.credits.remaining;
  } catch (e) {
    if (e.message?.includes("404") || e.message?.includes("UNKNOWN_SPORT") || e.message?.includes("INACTIVE_SPORT")) {
      summary.skipped = `Odds API inactive for ${cfg.sport_key}`;
      return summary;
    }
    summary.error = e.message;
    return summary;
  }
  if (!api.body?.length) { summary.skipped = "Odds API returned no events"; return summary; }

  const now = new Date().toISOString();
  const quoteRows = [];

  // 3. The outrights endpoint returns ONE event per sport_key with all
  // outcomes inside. The future's outcomes get attached to whichever Kalshi
  // event in our DB matches (in the typical case there's just one).
  for (const oaEvent of api.body) {
    const oaEventId = oaEvent.id;  // sports_book_quotes.odds_api_event_id is NOT NULL
    for (const bm of oaEvent.bookmakers || []) {
      const book = bm.key;
      for (const market of bm.markets || []) {
        if (market.key !== "outrights") continue;
        const outcomes = market.outcomes || [];
        // devigOutcomes expects [{prob_raw}] objects and returns each with
        // a prob_novig field added. Build the shape it wants, then read
        // back .prob_novig per index.
        const shaped = outcomes.map((o) => ({ prob_raw: americanToProb(o.price) }));
        const novigged = devigOutcomes(shaped);
        outcomes.forEach((o, idx) => {
          const oName = o.name;
          if (!oName) return;
          const am = typeof o.price === "number" ? o.price : null;
          if (am == null) return;
          // Find the matching Kalshi market across our candidate events
          for (const evt of events) {
            for (const m of markets) {
              if (m.event_id !== evt.id) continue;
              if (!softLabelMatch(oName, m.contestant_label, cfg.league)) continue;
              const probRaw = shaped[idx].prob_raw;
              const probNovig = novigged[idx]?.prob_novig;
              quoteRows.push({
                sports_event_id: evt.id,
                odds_api_event_id: oaEventId,
                league: cfg.league,
                contestant_label: m.contestant_label,
                contestant_norm: normalizeName(m.contestant_label),
                market_type: "outrights",
                book,
                american: am,
                implied_prob_raw: probRaw != null ? Number(probRaw.toFixed(5)) : null,
                implied_prob_novig: probNovig != null ? Number(probNovig.toFixed(5)) : null,
                point: null,
                fetched_at: now,
              });
              summary.events_matched++;
              return;
            }
          }
        });
      }
    }
  }

  for (let i = 0; i < quoteRows.length; i += 1000) {
    const slice = quoteRows.slice(i, i + 1000);
    const { error } = await supabase.from("sports_book_quotes").insert(slice);
    if (error) { summary.error = `insert: ${error.message}`; return summary; }
    summary.quotes += slice.length;
  }

  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.ODDS_API_KEY) return res.status(500).json({ error: "ODDS_API_KEY not set" });

  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const results = [];

  for (const cfg of FUTURES_MARKETS) {
    try { results.push(await ingestOne(supabase, cfg)); }
    catch (e) { results.push({ league: cfg.league, event_type: cfg.event_type, sport_key: cfg.sport_key, error: e.message }); }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    totals: {
      api_calls: results.reduce((s, r) => s + (r.api_calls || 0), 0),
      quotes: results.reduce((s, r) => s + (r.quotes || 0), 0),
    },
    by_market: results,
  });
}
