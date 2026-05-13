// Helpers for ingesting sportsbook odds from The Odds API (the-odds-api.com).
// Kept separate from _lib.js so the Kalshi path stays untouched.

import { normalizeName } from "./_lib.js";

export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Which Kalshi league key maps to which Odds API sport_key for H2H game lines.
// Outrights (championship winners) are a separate cron at lower cadence.
export const LEAGUE_TO_SPORT = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  epl: "soccer_epl",
  mls: "soccer_usa_mls",
};

export const LEAGUE_TO_FUTURES_SPORT = {
  nba: "basketball_nba_championship_winner",
  mlb: "baseball_mlb_world_series_winner",
  nhl: "icehockey_nhl_championship_winner",
  epl: "soccer_epl_winner",
  // MLS has no published futures market on Odds API as of 2026-05
};

// Hand overrides for ambiguous Kalshi names. Format: league → odds_team_norm → kalshi_norm
export const NAME_OVERRIDES = {
  mlb: {
    "chicago cubs": "chicago c",
    "chicago white sox": "chicago ws",
    "los angeles dodgers": "la dodgers",
    "los angeles angels": "la angels",
    "new york yankees": "ny yankees",
    "new york mets": "ny mets",
    "athletics": "a's",
    "oakland athletics": "a's",
  },
  nhl: {
    "new york rangers": "ny rangers",
    "new york islanders": "ny islanders",
    "los angeles kings": "la kings",
  },
  nba: {
    "los angeles lakers": "la lakers",
    "los angeles clippers": "la clippers",
    "new york knicks": "ny knicks",
  },
};

// Match an Odds API team name against the set of Kalshi contestants for a league.
// Strategy:
//   1. Direct equality on normalized name
//   2. Hand override
//   3. Kalshi name is a prefix-token of Odds API name (e.g. "san antonio" → "san antonio spurs")
//   4. Last word of Kalshi name matches last word of Odds name (e.g. "manchester city" matches itself)
// Returns the Kalshi contestant id or null.
export function matchContestant(oddsTeamName, league, kalshiNormToId) {
  const oddsNorm = normalizeName(oddsTeamName);

  // 1. Direct
  if (kalshiNormToId.has(oddsNorm)) return kalshiNormToId.get(oddsNorm);

  // 2. Override
  const override = NAME_OVERRIDES[league]?.[oddsNorm];
  if (override && kalshiNormToId.has(override)) return kalshiNormToId.get(override);

  // 3. Prefix-token: longest matching Kalshi-norm that is a prefix of Odds name
  let bestMatch = null;
  let bestLen = 0;
  for (const [knorm, id] of kalshiNormToId.entries()) {
    if (knorm === "tie") continue;
    if (oddsNorm === knorm || oddsNorm.startsWith(knorm + " ")) {
      if (knorm.length > bestLen) {
        bestLen = knorm.length;
        bestMatch = id;
      }
    }
  }
  if (bestMatch) return bestMatch;

  // 4. Substring fallback — only allow when single match to avoid Brooklyn/etc collisions
  const subs = [];
  for (const [knorm, id] of kalshiNormToId.entries()) {
    if (knorm === "tie" || knorm.length < 4) continue;
    if (oddsNorm.includes(knorm)) subs.push({ knorm, id });
  }
  if (subs.length === 1) return subs[0].id;

  return null;
}

// Convert American odds → raw implied prob (no de-vig)
export function americanToProb(american) {
  if (american == null) return null;
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 100 / (a + 100);
  return -a / (-a + 100);
}

// De-vig a set of mutually-exclusive prices for one event/market/book.
// outcomes: [{ name, prob_raw }, ...]
// Returns the same array with prob_novig field added.
export function devigOutcomes(outcomes) {
  const sum = outcomes.reduce((s, o) => s + (o.prob_raw ?? 0), 0);
  if (sum <= 0) return outcomes.map((o) => ({ ...o, prob_novig: null }));
  return outcomes.map((o) => ({
    ...o,
    prob_novig: o.prob_raw != null ? Number((o.prob_raw / sum).toFixed(5)) : null,
  }));
}

// Throttled fetch w/ exponential backoff + credit header capture.
export async function fetchOddsApi(path, params, attempt = 0) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("ODDS_API_KEY missing");
  const url = new URL(`${ODDS_API_BASE}${path}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  const lastCost = r.headers.get("x-requests-last");
  if (r.status === 429 && attempt < 4) {
    await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, attempt)));
    return fetchOddsApi(path, params, attempt + 1);
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OddsAPI ${r.status} ${path}: ${body.slice(0, 200)}`);
  }
  const body = await r.json();
  return { body, credits: { remaining, used, lastCost } };
}

// Bookmaker labels — used to normalize Odds API book keys to our display labels
// (which match the golf-side BOOK_LABELS in sportsbookish/lib/format.ts).
export const BOOK_KEYS = {
  draftkings: "draftkings",
  fanduel: "fanduel",
  betmgm: "betmgm",
  williamhill_us: "caesars",
  caesars: "caesars",
  betrivers: "betrivers",
  pointsbetus: "pointsbet",
  fanatics: "fanatics",
  bovada: "bovada",
  betonlineag: "betonline",
  mybookieag: "mybookie",
  lowvig: "lowvig",
  betus: "betus",
  unibet_us: "unibet",
};
export const normalizeBookKey = (k) => BOOK_KEYS[k] || k;
