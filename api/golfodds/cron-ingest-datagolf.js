import { createClient } from "@supabase/supabase-js";

const DG_BASE = "https://feeds.datagolf.com";

// DG markets -> our market_type codes
const DG_MARKETS = { win: "win", top_5: "t5", top_10: "t10", top_20: "t20", make_cut: "mc", frl: "r1lead" };
const KNOWN_BOOKS = ["draftkings", "fanduel", "circa", "betmgm", "caesars", "pinnacle", "bet365", "betonline", "bovada", "skybet", "williamhill", "pointsbet", "unibet", "betcris", "betway"];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

const normalizeName = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function canonicalPlayerName(raw) {
  if (!raw) return raw;
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

const americanToDecimal = (a) => (a == null ? null : a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1);
const decimalToImplied = (d) => (d ? 1 / d : null);

function devigField(rawProbs, expectedSum) {
  const total = rawProbs.reduce((s, p) => s + (p || 0), 0);
  if (!total) return rawProbs.map(() => null);
  const scale = expectedSum / total;
  return rawProbs.map((p) => (p == null ? null : p * scale));
}

async function fetchDG(path, params = {}) {
  const url = new URL(`${DG_BASE}${path}`);
  url.searchParams.set("key", process.env.DATAGOLF_API_KEY);
  url.searchParams.set("file_format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`DG ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function ingestMarket(supabase, dgMarket, marketType) {
  const payload = await fetchDG("/betting-tools/outrights", { tour: "pga", market: dgMarket, odds_format: "american" });
  const eventName = payload.event_name || "Unknown Event";
  const players = payload.odds || [];
  if (!players.length) return { book: 0, model: 0 };

  // Find tournament by name (DG name matches our canonical "PGA Championship" etc.)
  const { data: tdata } = await supabase
    .from("golfodds_tournaments")
    .select("id")
    .eq("name", eventName)
    .maybeSingle();
  let tournamentId = tdata?.id;
  if (!tournamentId) {
    const { data, error } = await supabase
      .from("golfodds_tournaments")
      .insert({ tour: "pga", name: eventName, status: "upcoming" })
      .select("id")
      .single();
    if (error) throw new Error(`create tournament: ${error.message}`);
    tournamentId = data.id;
  }

  // Players (canonical names)
  const playerMap = new Map();
  for (const p of players) {
    if (!p.player_name) continue;
    const name = canonicalPlayerName(p.player_name);
    const norm = normalizeName(name);
    if (!playerMap.has(norm)) playerMap.set(norm, { name, normalized_name: norm, dg_id: p.dg_id || null });
  }
  const playerIdByNorm = new Map();
  const rows = Array.from(playerMap.values());
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from("golfodds_players")
      .upsert(rows.slice(i, i + 500), { onConflict: "normalized_name" })
      .select("id, normalized_name");
    if (error) throw new Error(`upsert players: ${error.message}`);
    for (const p of data) playerIdByNorm.set(p.normalized_name, p.id);
  }

  // Markets
  const marketRows = [];
  const seen = new Set();
  for (const p of players) {
    const norm = normalizeName(canonicalPlayerName(p.player_name));
    const pid = playerIdByNorm.get(norm);
    if (!pid) continue;
    const k = `${tournamentId}|${pid}|${marketType}`;
    if (seen.has(k)) continue;
    seen.add(k);
    marketRows.push({ tournament_id: tournamentId, player_id: pid, market_type: marketType });
  }
  const marketIdByPlayerId = new Map();
  for (let i = 0; i < marketRows.length; i += 500) {
    const { data, error } = await supabase
      .from("golfodds_markets")
      .upsert(marketRows.slice(i, i + 500), { onConflict: "tournament_id,player_id,market_type" })
      .select("id, player_id");
    if (error) throw new Error(`upsert markets: ${error.message}`);
    for (const mm of data) marketIdByPlayerId.set(mm.player_id, mm.id);
  }

  // Discover books in the payload
  const bookCols = new Set();
  for (const p of players) {
    for (const k of Object.keys(p)) {
      if (k === "player_name" || k === "dg_id" || k === "datagolf") continue;
      if (parseAmerican(p[k]) != null) bookCols.add(k);
    }
  }

  // De-vig per book (field-sum). Skip for binary markets like make_cut.
  const FIELD_SUM = { win: 1, t5: 5, t10: 10, t20: 20, r1lead: 1 };
  const expectedSum = FIELD_SUM[marketType];
  const novigByBook = {};
  for (const book of bookCols) {
    const raw = players.map((p) => decimalToImplied(americanToDecimal(parseAmerican(p[book]))));
    novigByBook[book] = expectedSum != null ? devigField(raw, expectedSum) : raw;
  }

  // Build book quote rows + DG model rows
  const bookQuoteRows = [];
  const dgModelRows = [];
  players.forEach((p, idx) => {
    const norm = normalizeName(canonicalPlayerName(p.player_name));
    const pid = playerIdByNorm.get(norm);
    if (!pid) return;
    const mid = marketIdByPlayerId.get(pid);
    if (!mid) return;
    for (const book of bookCols) {
      const am = parseAmerican(p[book]);
      if (am == null) continue;
      const dec = americanToDecimal(am);
      const implied = decimalToImplied(dec);
      bookQuoteRows.push({
        market_id: mid,
        book,
        price_american: am,
        price_decimal: dec ? Number(dec.toFixed(3)) : null,
        implied_prob: implied != null ? Number(implied.toFixed(4)) : null,
        novig_prob: novigByBook[book][idx] != null ? Number(novigByBook[book][idx].toFixed(4)) : null,
      });
    }
    const dg = p.datagolf || {};
    const baseAm = parseAmerican(dg.baseline);
    const fitAm = parseAmerican(dg.baseline_history_fit);
    const dgProb = decimalToImplied(americanToDecimal(baseAm));
    const dgFit = decimalToImplied(americanToDecimal(fitAm));
    if (dgProb != null || dgFit != null) {
      dgModelRows.push({
        market_id: mid,
        dg_prob: dgProb != null ? Number(dgProb.toFixed(4)) : null,
        dg_fit_prob: dgFit != null ? Number(dgFit.toFixed(4)) : null,
      });
    }
  });

  let bookInserted = 0;
  for (let i = 0; i < bookQuoteRows.length; i += 1000) {
    const { error } = await supabase.from("golfodds_book_quotes").insert(bookQuoteRows.slice(i, i + 1000));
    if (error) throw new Error(`insert book quotes: ${error.message}`);
    bookInserted += Math.min(1000, bookQuoteRows.length - i);
  }
  let modelInserted = 0;
  for (let i = 0; i < dgModelRows.length; i += 1000) {
    const { error } = await supabase.from("golfodds_dg_model").insert(dgModelRows.slice(i, i + 1000));
    if (error) throw new Error(`insert dg model: ${error.message}`);
    modelInserted += Math.min(1000, dgModelRows.length - i);
  }
  return { book: bookInserted, model: modelInserted };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.DATAGOLF_API_KEY) return res.status(500).json({ error: "DATAGOLF_API_KEY not set" });

  const supabase = getSupabase();
  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-ingest-datagolf", started_at: startedAt })
    .select("id")
    .single();

  let totalBook = 0;
  let totalModel = 0;
  let totalErrors = 0;
  const summary = {};

  for (const [dgMarket, marketType] of Object.entries(DG_MARKETS)) {
    try {
      const r = await ingestMarket(supabase, dgMarket, marketType);
      summary[dgMarket] = { book: r.book, model: r.model };
      totalBook += r.book;
      totalModel += r.model;
    } catch (e) {
      totalErrors++;
      summary[dgMarket] = { error: e.message };
    }
  }

  if (runRow?.id) {
    await supabase
      .from("golfodds_cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_inserted: totalBook + totalModel,
        errors: totalErrors,
        notes: JSON.stringify(summary),
      })
      .eq("id", runRow.id);
  }

  await supabase
    .from("golfodds_data_sources")
    .update({ last_import: new Date().toISOString(), record_count: totalBook })
    .eq("name", "datagolf");

  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    book_quotes: totalBook,
    model_rows: totalModel,
    errors: totalErrors,
    by_market: summary,
  });
}
