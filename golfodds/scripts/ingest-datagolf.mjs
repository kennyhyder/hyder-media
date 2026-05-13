#!/usr/bin/env node
/**
 * DataGolf ingester — per-book outright odds + DataGolf model probabilities.
 *
 * What this does (V1 — single snapshot, idempotent):
 *   1. For each market type (win, t5, t10, t20, mc), call
 *      /betting-tools/outrights and store one row per (market, book)
 *   2. Extract DataGolf's own baseline + course-fit probabilities
 *
 * DataGolf rate limit: 45 req/min. We sleep between calls.
 *
 * Run:  node --env-file=../.env.local scripts/ingest-datagolf.mjs
 * Or:   npm run ingest:datagolf
 *
 * Required env:
 *   DATAGOLF_API_KEY     (Scratch+ membership)
 *   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const DG_BASE = "https://feeds.datagolf.com";
const DG_KEY = process.env.DATAGOLF_API_KEY;

if (!DG_KEY) {
  console.error("ERROR: DATAGOLF_API_KEY not set in env.");
  process.exit(1);
}

// Node 20 lacks native WebSocket; supply `ws` so Supabase client constructs.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

// DataGolf market name -> our market_type code. DG only publishes these
// pre-tournament markets; round-by-round leader/top-N are Kalshi-only.
const DG_MARKETS = {
  win: "win",
  top_5: "t5",
  top_10: "t10",
  top_20: "t20",
  make_cut: "mc",
  frl: "r1lead",
};

// Books DataGolf returns (key as it appears in the JSON payload).
// We pass them through as-is; the column is freeform text.
const KNOWN_BOOKS = [
  "draftkings", "fanduel", "circa", "betmgm", "caesars", "pinnacle",
  "bet365", "betonline", "bovada", "skybet", "williamhill", "unibet", "betway", "betcris",
];

// DataGolf returns names as "Last, First". Flip to "First Last" so they match
// the format Kalshi uses ("Scottie Scheffler"), enabling cross-source player
// reconciliation via the shared normalized_name unique key.
function canonicalPlayerName(raw) {
  if (!raw) return raw;
  const s = raw.trim();
  const i = s.indexOf(",");
  if (i < 0) return s;
  const last = s.slice(0, i).trim();
  const rest = s.slice(i + 1).trim();
  return `${rest} ${last}`.trim();
}

const normalizeName = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DataGolf returns odds as strings like "+450" or "-300". Parse to int.
function parseAmerican(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "NaN" || s === "-") return null;
  const n = parseInt(s.replace(/^\+/, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// American → decimal odds
function americanToDecimal(a) {
  if (a == null) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}

// Decimal → implied probability (raw, with vig)
const decimalToImplied = (d) => (d ? 1 / d : null);

// De-vig for mutually-exclusive multi-outcome markets (Win/T5/T10/T20): the
// field's implied probabilities should sum to the outcome count (1, 5, 10, 20).
// Scale each prob so that constraint holds.
function devigField(rawProbs, expectedSum) {
  const total = rawProbs.reduce((s, p) => s + (p || 0), 0);
  if (!total) return rawProbs.map(() => null);
  const scale = expectedSum / total;
  return rawProbs.map((p) => (p == null ? null : p * scale));
}

async function fetchDG(path, params = {}) {
  const url = new URL(`${DG_BASE}${path}`);
  url.searchParams.set("key", DG_KEY);
  url.searchParams.set("file_format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`DataGolf ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

// --- Upserters -------------------------------------------------------------

async function upsertTournament(eventName, dgEventId) {
  const row = {
    tour: "pga",
    name: eventName,
    dg_event_id: dgEventId || null,
    status: "upcoming",
  };
  // Match by name+dg_event_id; if dg_event_id is null, name-only
  const { data: existing } = await supabase
    .from("golfodds_tournaments")
    .select("id")
    .eq("name", eventName)
    .maybeSingle();
  if (existing) {
    if (dgEventId) {
      await supabase.from("golfodds_tournaments").update({ dg_event_id: dgEventId }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data, error } = await supabase
    .from("golfodds_tournaments")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`upsert tournament "${eventName}": ${error.message}`);
  return data.id;
}

async function upsertPlayer(rawName, dgId) {
  const name = canonicalPlayerName(rawName);
  const normalized = normalizeName(name);
  // Try by dg_id first if present
  if (dgId) {
    const { data } = await supabase.from("golfodds_players").select("id").eq("dg_id", dgId).maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await supabase
    .from("golfodds_players")
    .upsert(
      { name: name.trim(), normalized_name: normalized, dg_id: dgId || null },
      { onConflict: "normalized_name" }
    )
    .select("id")
    .single();
  if (error) throw new Error(`upsert player "${name}": ${error.message}`);
  return data.id;
}

async function upsertMarket(tournamentId, playerId, marketType) {
  const { data, error } = await supabase
    .from("golfodds_markets")
    .upsert(
      { tournament_id: tournamentId, player_id: playerId, market_type: marketType },
      { onConflict: "tournament_id,player_id,market_type" }
    )
    .select("id")
    .single();
  if (error) throw new Error(`upsert market: ${error.message}`);
  return data.id;
}

// --- Per-market ingestion --------------------------------------------------

async function ingestMarket(dgMarket, marketType) {
  console.log(`\n--- ${dgMarket} (${marketType}) ---`);

  const payload = await fetchDG("/betting-tools/outrights", {
    tour: "pga",
    market: dgMarket,
    odds_format: "american",
  });

  const eventName = payload.event_name || "Unknown Event";
  const dgEventId = payload.event_id || null;
  console.log(`  Event: ${eventName} (DG id: ${dgEventId})`);

  const players = payload.odds || [];
  console.log(`  ${players.length} players in field`);

  const tournamentId = await upsertTournament(eventName, dgEventId);

  // Pre-compute de-vigged probs per book.
  // DataGolf returns each player with a top-level `datagolf.baseline` and a
  // map of book -> american odds (as strings). Collect book columns and de-vig.
  const bookCols = new Set();
  for (const p of players) {
    for (const k of Object.keys(p)) {
      if (k === "player_name" || k === "dg_id" || k === "datagolf") continue;
      if (parseAmerican(p[k]) != null) bookCols.add(k);
    }
  }
  // Honor server's `books_offering` if present
  if (Array.isArray(payload.books_offering)) {
    for (const b of payload.books_offering) bookCols.add(b);
  }
  // Pick the right de-vig strategy. Field-sum scaling works for mutually
  // exclusive Top-N markets (sum should equal the bucket size). Make Cut is a
  // per-player binary (each market is independent), so we can't sum-scale.
  // For MC, leave the raw implied prob alone — the book's vig stays in.
  const FIELD_SUM = { win: 1, t5: 5, t10: 10, t20: 20 };
  const expectedSum = FIELD_SUM[marketType];

  // Build per-book novig probability arrays aligned to `players` order
  const novigByBook = {};
  for (const book of bookCols) {
    const rawProbs = players.map((p) => {
      const am = parseAmerican(p[book]);
      const dec = americanToDecimal(am);
      return decimalToImplied(dec);
    });
    novigByBook[book] = expectedSum != null ? devigField(rawProbs, expectedSum) : rawProbs;
  }

  let quotes = 0;
  let modelRows = 0;
  let errors = 0;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    try {
      const rawName = p.player_name;
      if (!rawName) continue;
      const playerId = await upsertPlayer(rawName, p.dg_id);
      const marketId = await upsertMarket(tournamentId, playerId, marketType);

      // Insert one book quote row per book that has odds for this player
      const bookRows = [];
      for (const book of bookCols) {
        const am = parseAmerican(p[book]);
        if (am == null) continue;
        const dec = americanToDecimal(am);
        const implied = decimalToImplied(dec);
        bookRows.push({
          market_id: marketId,
          book,
          price_american: am,
          price_decimal: dec ? Number(dec.toFixed(3)) : null,
          implied_prob: implied ? Number(implied.toFixed(4)) : null,
          novig_prob: novigByBook[book][i] != null ? Number(novigByBook[book][i].toFixed(4)) : null,
        });
      }
      if (bookRows.length) {
        const { error } = await supabase.from("golfodds_book_quotes").insert(bookRows);
        if (error) throw new Error(`insert book quotes: ${error.message}`);
        quotes += bookRows.length;
      }

      // DataGolf's own model — also returned as American odds strings.
      // Convert to implied probability for storage (column is named *_prob).
      const dg = p.datagolf || {};
      const dgBaselineAm = parseAmerican(dg.baseline);
      const dgFitAm = parseAmerican(dg.baseline_history_fit);
      const dgProb = decimalToImplied(americanToDecimal(dgBaselineAm));
      const dgFitProb = decimalToImplied(americanToDecimal(dgFitAm));
      if (dgProb != null || dgFitProb != null) {
        await supabase.from("golfodds_dg_model").insert({
          market_id: marketId,
          dg_prob: dgProb != null ? Number(dgProb.toFixed(4)) : null,
          dg_fit_prob: dgFitProb != null ? Number(dgFitProb.toFixed(4)) : null,
        });
        modelRows++;
      }
    } catch (e) {
      errors++;
      console.error(`    ${p.player_name || "(unknown)"}: ${e.message}`);
    }
  }

  console.log(`  Inserted: ${quotes} book quotes, ${modelRows} model rows, ${errors} errors`);
  return { quotes, modelRows, errors };
}

// --- Main ------------------------------------------------------------------

async function main() {
  const totals = { quotes: 0, modelRows: 0, errors: 0 };
  for (const [dgMarket, marketType] of Object.entries(DG_MARKETS)) {
    try {
      const r = await ingestMarket(dgMarket, marketType);
      totals.quotes += r.quotes;
      totals.modelRows += r.modelRows;
      totals.errors += r.errors;
    } catch (e) {
      console.error(`! ${dgMarket}: ${e.message}`);
      totals.errors++;
    }
    await sleep(1500); // stay well under 45 req/min
  }

  await supabase
    .from("golfodds_data_sources")
    .update({ last_import: new Date().toISOString(), record_count: totals.quotes })
    .eq("name", "datagolf");

  console.log(
    `\nDone. ${totals.quotes} book quotes, ${totals.modelRows} model rows, ${totals.errors} errors.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
