import { createClient } from "@supabase/supabase-js";
import { resolveTournament } from "./_tournament_resolver.js";
import { americanToDecimal, decimalToImplied, devigProbs } from "../_platform/odds.js";

// DataGolf matchup-book ingester.
//
// Pulls /betting-tools/matchups for each (market, tour) combo, matches
// each DG matchup to an existing golfodds_matchups row by player-set
// (so we only ingest book prices for matchups that ALSO have Kalshi
// counterparts), and writes per-book prices to
// golfodds_matchup_book_quotes.
//
// We don't create DG-only matchups because the whole point of the table
// is Kalshi-vs-books comparison. A book-only matchup with no Kalshi
// twin has no comparison value and would clutter the UI.
//
// GET /api/golfodds/cron-ingest-matchup-books
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const DG_BASE = "https://feeds.datagolf.com";

// DataGolf market types → our golfodds_matchups.matchup_type values
const DG_MARKETS = [
  { dg: "tournament_matchups", matchupType: "h2h",   scope: "tournament" },
  { dg: "round_matchups",      matchupType: "h2h",   scope: "round" },
  { dg: "3_balls",             matchupType: "3ball", scope: "round" },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

const normalizeName = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

function canonicalPlayerName(raw) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  const i = s.indexOf(",");
  if (i < 0) return s;
  return `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.trim();
}

function parseAmerican(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "NaN" || s === "-") return null;
  const n = parseInt(s.replace(/^\+/, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// americanToDecimal, decimalToImplied, devigProbs imported from _platform/odds.js

async function fetchDG(path, params = {}) {
  const url = new URL(`${DG_BASE}${path}`);
  url.searchParams.set("key", process.env.DATAGOLF_API_KEY);
  url.searchParams.set("file_format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`DG ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function ingestMarket(supabase, dgConfig) {
  const summary = { market: dgConfig.dg, scope: dgConfig.scope, matchups_matched: 0, quotes: 0, skipped: null };

  let payload;
  try {
    payload = await fetchDG("/betting-tools/matchups", { tour: "pga", market: dgConfig.dg, odds_format: "american" });
  } catch (e) {
    summary.error = e.message;
    return summary;
  }

  const eventName = payload.event_name;
  // DG returns a string like "No tournament_matchups available for this event"
  // when the market is closed. Skip cleanly.
  const matchups = Array.isArray(payload.match_list) ? payload.match_list : [];
  if (!matchups.length) {
    summary.skipped = typeof payload.match_list === "string" ? `DG: ${payload.match_list.slice(0, 80)}` : "no matchups";
    return summary;
  }

  // Look up tournament via shared name-resolver. Don't auto-create
  // here — matchups exist only when Kalshi has already seeded the
  // tournament; if the resolver can't find it, the Kalshi ingester
  // will create it next cycle.
  const resolved = await resolveTournament(supabase, eventName, { allowCreate: false });
  if (!resolved.id) {
    summary.skipped = resolved.reason || `tournament '${eventName}' not in DB yet`;
    return summary;
  }
  const tournament = { id: resolved.id };

  // Pull every existing Kalshi-driven matchup for this tournament + matchup_type
  // plus the players in each matchup. Build an index keyed by normalized
  // player-set so we can match DG payloads.
  const { data: existingMatchups } = await supabase
    .from("golfodds_matchups")
    .select("id, matchup_type, round_number, scope, golfodds_matchup_players ( id, player_id, golfodds_players ( id, name, normalized_name ) )")
    .eq("tournament_id", tournament.id)
    .eq("matchup_type", dgConfig.matchupType);

  if (!existingMatchups?.length) {
    summary.skipped = `no existing ${dgConfig.matchupType} matchups for tournament`;
    return summary;
  }

  // Index: sorted-normalized-player-names → { matchupId, mpIdByPlayerNorm }
  const matchupIndex = new Map();
  for (const m of existingMatchups) {
    const players = (m.golfodds_matchup_players || []).map((mp) => ({
      mpId: mp.id,
      playerId: mp.player_id,
      norm: mp.golfodds_players?.normalized_name,
    })).filter((p) => p.norm);
    if (!players.length) continue;
    const key = players.map((p) => p.norm).sort().join("|");
    matchupIndex.set(key, {
      matchupId: m.id,
      scope: m.scope,
      round: m.round_number,
      mpByNorm: new Map(players.map((p) => [p.norm, p.mpId])),
    });
  }

  // For each DG matchup, find matching DB matchup + insert per-book quotes
  const quoteRows = [];
  for (const dgm of matchups) {
    // DG payload shape (current API): {
    //   players: [{ player_name, dg_id }, ...] OR { p1: {...}, p2: {...}, p3: {...} } depending on era
    //   odds: { book1: { p1: -120, p2: +100, [p3: ...] }, book2: {...}, ... }
    // }
    const players = [];
    if (Array.isArray(dgm.players)) {
      for (const p of dgm.players) {
        if (p?.player_name) players.push({ name: canonicalPlayerName(p.player_name), slot: p.slot || `p${players.length + 1}` });
      }
    } else {
      // Older shape: top-level p1/p2/p3 keys
      for (const slot of ["p1", "p2", "p3"]) {
        const p = dgm[slot];
        if (p?.player_name) players.push({ name: canonicalPlayerName(p.player_name), slot });
      }
    }
    if (!players.length) continue;
    const setKey = players.map((p) => normalizeName(p.name)).sort().join("|");
    const match = matchupIndex.get(setKey);
    if (!match) continue;  // no Kalshi twin for this set — skip
    summary.matchups_matched++;

    // Odds keyed by book name
    const odds = dgm.odds || {};
    for (const [book, perBook] of Object.entries(odds)) {
      if (!perBook || typeof perBook !== "object") continue;
      // For each slot we have a price; map slot → player by index into players[]
      // DG slots may be p1/p2/p3; our players array preserves payload order.
      // Compute de-vigged probabilities across the matchup (sum to 1).
      const americans = players.map((p) => parseAmerican(perBook[p.slot]));
      if (americans.every((a) => a == null)) continue;
      const rawProbs = americans.map((a) => decimalToImplied(americanToDecimal(a)));
      const novigs = devigProbs(rawProbs);
      players.forEach((p, idx) => {
        const am = americans[idx];
        if (am == null) return;
        const norm = normalizeName(p.name);
        const mpId = match.mpByNorm.get(norm);
        if (!mpId) return;
        const dec = americanToDecimal(am);
        const implied = decimalToImplied(dec);
        quoteRows.push({
          matchup_player_id: mpId,
          book,
          price_american: am,
          price_decimal: dec != null ? Number(dec.toFixed(3)) : null,
          implied_prob: implied != null ? Number(implied.toFixed(4)) : null,
          novig_prob: novigs[idx] != null ? Number(novigs[idx].toFixed(4)) : null,
        });
      });
    }
  }

  for (let i = 0; i < quoteRows.length; i += 1000) {
    const slice = quoteRows.slice(i, i + 1000);
    const { error } = await supabase.from("golfodds_matchup_book_quotes").insert(slice);
    if (error) { summary.error = `insert: ${error.message}`; return summary; }
    summary.quotes += slice.length;
  }

  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.DATAGOLF_API_KEY) return res.status(500).json({ error: "DATAGOLF_API_KEY not set" });

  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const results = [];

  for (const cfg of DG_MARKETS) {
    try {
      results.push(await ingestMarket(supabase, cfg));
    } catch (e) {
      results.push({ market: cfg.dg, error: e.message });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_quotes: results.reduce((s, r) => s + (r.quotes || 0), 0),
    total_matchups_matched: results.reduce((s, r) => s + (r.matchups_matched || 0), 0),
    by_market: results,
  });
}
