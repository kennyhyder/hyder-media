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
};

// Hand overrides per league for cases the heuristics can't resolve.
// Maps a normalized Odds API team name → the normalized Kalshi market label.
export const NAME_OVERRIDES = {
  mlb: {
    "chicago cubs": "chicago c",
    "chicago white sox": "chicago ws",
    "los angeles dodgers": "la dodgers",
    "los angeles angels": "la angels",
    "new york yankees": "ny yankees",
    "new york mets": "ny mets",
    "athletics": "as",
    "oakland athletics": "as",
  },
  mls: {
    "dc united": "dc united",
    "d c united": "dc united",
    "new york red bulls": "new york rb",
    "new york city fc": "new york city",
    "los angeles fc": "los angeles f",
    "los angeles galaxy": "los angeles g",
    "la galaxy": "los angeles g",
    "lafc": "los angeles f",
    "sporting kansas city": "kansas city",
    "st louis city sc": "saint louis",
    "st louis city": "saint louis",
    "saint louis city sc": "saint louis",
    "minnesota united": "minnesota",
    "minnesota united fc": "minnesota",
    "seattle sounders fc": "seattle",
    "columbus crew sc": "columbus",
    "fc cincinnati": "cincinnati",
    "atlanta united fc": "atlanta",
    "atlanta united": "atlanta",
    "inter miami cf": "miami",
    "real salt lake": "salt lake",
    "new england revolution": "new england",
    "fc dallas": "dallas",
    "houston dynamo": "houston",
    "houston dynamo fc": "houston",
    "san jose earthquakes": "san jose",
    "vancouver whitecaps fc": "vancouver",
    "vancouver whitecaps": "vancouver",
    "cf montreal": "montreal",
    "portland timbers": "portland",
    "philadelphia union": "philadelphia",
    "orlando city sc": "orlando",
    "nashville sc": "nashville",
    "fc cincinnati": "cincinnati",
    "colorado rapids": "colorado",
    "charlotte fc": "charlotte",
    "chicago fire fc": "chicago fire",
    "austin fc": "austin",
    "toronto fc": "toronto",
  },
  epl: {
    "nottingham forest": "nottingham",
    "newcastle united": "newcastle",
    "wolverhampton wanderers": "wolverhampton",
    "tottenham hotspur": "tottenham",
    "west ham united": "west ham",
    "brighton and hove albion": "brighton",
  },
};

// Strip punctuation + collapse spaces — used on top of normalizeName for
// punctuation-heavy team names like "D.C. United".
export function normalizeForMatch(s) {
  return normalizeName(s || "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True if a Kalshi market label could refer to the same team as an Odds API name.
// Handles: direct match, override, last-word match (ANA Ducks vs Anaheim Ducks),
// prefix match (Boston vs Boston Celtics), substring (in either direction).
export function softLabelMatch(oddsName, kalshiLabel, league) {
  if (!oddsName || !kalshiLabel) return false;
  const o = normalizeForMatch(oddsName);
  const k = normalizeForMatch(kalshiLabel);
  if (!o || !k || k === "tie") return false;

  if (o === k) return true;

  const override = NAME_OVERRIDES[league]?.[o];
  if (override && override === k) return true;

  // Prefix match (Kalshi is shorter, Odds adds suffix)
  if (o.startsWith(k + " ")) return true;
  if (k.startsWith(o + " ")) return true;

  // Last-word match — e.g. "ana ducks" vs "anaheim ducks"
  const oWords = o.split(" ");
  const kWords = k.split(" ");
  if (oWords.length >= 2 && kWords.length >= 2) {
    if (oWords[oWords.length - 1] === kWords[kWords.length - 1]) return true;
  }

  // Substring (one fully contains the other surrounded by spaces or boundaries)
  if (o.includes(" " + k + " ") || k.includes(" " + o + " ")) return true;
  if (o.endsWith(" " + k) || k.endsWith(" " + o)) return true;

  return false;
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
export function devigOutcomes(outcomes) {
  const sum = outcomes.reduce((s, o) => s + (o.prob_raw ?? 0), 0);
  if (sum <= 0) return outcomes.map((o) => ({ ...o, prob_novig: null }));
  return outcomes.map((o) => ({
    ...o,
    prob_novig: o.prob_raw != null ? Number((o.prob_raw / sum).toFixed(5)) : null,
  }));
}

// Throttled fetch w/ backoff + credit header capture
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

// Bookmaker key → display label normalization (matches golf-side BOOK_LABELS)
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
