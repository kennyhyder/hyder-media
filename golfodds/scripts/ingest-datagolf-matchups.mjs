#!/usr/bin/env node
/**
 * DataGolf matchup ingester — pulls tournament H2H matchups and links them to
 * existing Kalshi H2H matchups by dg_id pair. Inserts per-book quotes into
 * golfodds_matchup_book_quotes.
 *
 * DG round_matchups are 2-player per-round bets. Kalshi's per-round equivalent
 * is the 3-ball, which has a different shape — so we don't link those.
 *
 * Run after `ingest-kalshi.mjs` so the matchups + players exist in the DB.
 *   node --env-file=../.env.local scripts/ingest-datagolf-matchups.mjs
 */

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const DG_BASE = "https://feeds.datagolf.com";
const DG_KEY = process.env.DATAGOLF_API_KEY;

if (!DG_KEY) {
  console.error("ERROR: DATAGOLF_API_KEY not set in env.");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

function parseAmerican(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "NaN" || s === "-") return null;
  const n = parseInt(s.replace(/^\+/, ""), 10);
  return Number.isFinite(n) ? n : null;
}
const americanToDecimal = (a) => (a == null ? null : a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1);
const decimalToImplied = (d) => (d ? 1 / d : null);

async function fetchDG(path, params = {}) {
  const url = new URL(`${DG_BASE}${path}`);
  url.searchParams.set("key", DG_KEY);
  url.searchParams.set("file_format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`DataGolf ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

// Load all Kalshi tournament-scope H2H matchups with their players' dg_ids.
async function loadKalshiH2H() {
  const { data: matchups, error: mErr } = await supabase
    .from("golfodds_matchups")
    .select("id, matchup_type, scope, kalshi_event_ticker")
    .eq("matchup_type", "h2h")
    .eq("scope", "tournament")
    .range(0, 9999);
  if (mErr) throw new Error(mErr.message);
  if (!matchups?.length) return [];

  const ids = matchups.map((m) => m.id);
  const { data: mp, error: pErr } = await supabase
    .from("golfodds_matchup_players")
    .select("id, matchup_id, player_id, golfodds_players(dg_id, name)")
    .in("matchup_id", ids)
    .range(0, 9999);
  if (pErr) throw new Error(pErr.message);

  const byMatchup = new Map();
  for (const p of mp || []) {
    if (!byMatchup.has(p.matchup_id)) byMatchup.set(p.matchup_id, []);
    byMatchup.get(p.matchup_id).push({
      matchup_player_id: p.id,
      player_id: p.player_id,
      dg_id: p.golfodds_players?.dg_id ?? null,
      name: p.golfodds_players?.name ?? null,
    });
  }
  return matchups.map((m) => ({ ...m, players: byMatchup.get(m.id) || [] }));
}

// De-vig p1/p2 (plus tie if present) so they sum to 1 — gives fair probability
function devigPair(implP1, implP2, implTie) {
  const total = (implP1 || 0) + (implP2 || 0) + (implTie || 0);
  if (!total) return { p1: null, p2: null, tie: null };
  return {
    p1: implP1 != null ? implP1 / total : null,
    p2: implP2 != null ? implP2 / total : null,
    tie: implTie != null ? implTie / total : null,
  };
}

async function main() {
  console.log("Loading Kalshi H2H tournament matchups…");
  const kMatchups = await loadKalshiH2H();
  console.log(`  ${kMatchups.length} Kalshi H2H matchups`);

  // Index by sorted dg_id pair
  const byDgPair = new Map();
  for (const km of kMatchups) {
    const dgIds = km.players.map((p) => p.dg_id).filter((x) => x != null);
    if (dgIds.length !== 2) continue;
    const key = dgIds.slice().sort((a, b) => a - b).join("-");
    byDgPair.set(key, km);
  }
  console.log(`  ${byDgPair.size} matchups indexable by DG ID pair`);

  console.log("\nFetching DG tournament_matchups…");
  const dg = await fetchDG("/betting-tools/matchups", { tour: "pga", market: "tournament_matchups", odds_format: "american" });
  const matches = dg.match_list || [];
  console.log(`  ${matches.length} DG matchups for ${dg.event_name}`);

  let inserted = 0;
  let matched = 0;
  let skipped = 0;

  for (const dgMatch of matches) {
    const p1Id = dgMatch.p1_dg_id;
    const p2Id = dgMatch.p2_dg_id;
    if (!p1Id || !p2Id) {
      skipped++;
      continue;
    }
    const key = [p1Id, p2Id].sort((a, b) => a - b).join("-");
    const km = byDgPair.get(key);
    if (!km) {
      skipped++;
      continue;
    }
    matched++;

    // Map Kalshi player rows by dg_id
    const kalshiByDgId = new Map(km.players.map((p) => [p.dg_id, p]));
    const odds = dgMatch.odds || {};

    for (const [book, bookOdds] of Object.entries(odds)) {
      if (book === "datagolf") continue; // skip DG's own model line for matchups
      const amP1 = parseAmerican(bookOdds.p1);
      const amP2 = parseAmerican(bookOdds.p2);
      const amTie = parseAmerican(bookOdds.tie);
      if (amP1 == null && amP2 == null) continue;

      const implP1 = decimalToImplied(americanToDecimal(amP1));
      const implP2 = decimalToImplied(americanToDecimal(amP2));
      const implTie = decimalToImplied(americanToDecimal(amTie));
      const dv = devigPair(implP1, implP2, implTie);

      // Insert one row per side
      const rows = [];
      const p1Kalshi = kalshiByDgId.get(p1Id);
      const p2Kalshi = kalshiByDgId.get(p2Id);
      if (p1Kalshi && amP1 != null) {
        rows.push({
          matchup_player_id: p1Kalshi.matchup_player_id,
          book,
          price_american: amP1,
          price_decimal: americanToDecimal(amP1) ? Number(americanToDecimal(amP1).toFixed(3)) : null,
          implied_prob: implP1 != null ? Number(implP1.toFixed(4)) : null,
          novig_prob: dv.p1 != null ? Number(dv.p1.toFixed(4)) : null,
        });
      }
      if (p2Kalshi && amP2 != null) {
        rows.push({
          matchup_player_id: p2Kalshi.matchup_player_id,
          book,
          price_american: amP2,
          price_decimal: americanToDecimal(amP2) ? Number(americanToDecimal(amP2).toFixed(3)) : null,
          implied_prob: implP2 != null ? Number(implP2.toFixed(4)) : null,
          novig_prob: dv.p2 != null ? Number(dv.p2.toFixed(4)) : null,
        });
      }
      if (rows.length) {
        const { error } = await supabase.from("golfodds_matchup_book_quotes").insert(rows);
        if (error) {
          console.error(`  insert ${book}: ${error.message}`);
        } else {
          inserted += rows.length;
        }
      }
    }
  }

  console.log(`\nDone. Matched ${matched} / ${matches.length} DG matchups to Kalshi (skipped ${skipped}). Inserted ${inserted} book quotes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
