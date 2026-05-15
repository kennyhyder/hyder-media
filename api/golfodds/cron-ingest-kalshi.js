import { createClient } from "@supabase/supabase-js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// What this cron pulls every tick. Optimized for the markets that move most.
// (Full per-round Top-N and round-leader series run on the slower cron in
// cron-ingest-kalshi-full.js — added later.)
const KALSHI_SERIES = [
  { ticker: "KXPGATOUR",      marketType: "win", isWinner: true  },
  { ticker: "KXPGAMAKECUT",   marketType: "mc",  isWinner: false },
  { ticker: "KXPGATOP5",      marketType: "t5",  isWinner: false },
  { ticker: "KXPGATOP10",     marketType: "t10", isWinner: false },
  { ticker: "KXPGATOP20",     marketType: "t20", isWinner: false },
  { ticker: "KXPGAR1LEAD",    marketType: "r1lead", isWinner: false },
];

const KALSHI_MATCHUP_SERIES = [
  { ticker: "KXPGAH2H",   matchupType: "h2h",   scope: "tournament" },
  { ticker: "KXPGA3BALL", matchupType: "3ball", scope: "round" },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

const normalizeName = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function slugifyKalshi(s) {
  if (!s) return null;
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || null;
}

function canonicalTournamentName(title) {
  if (!title) return title;
  return title.replace(/\s+winner$/i, "").trim();
}

function tournamentSuffix(eventTicker) {
  const i = eventTicker.indexOf("-");
  return i > -1 ? eventTicker.slice(i + 1) : eventTicker;
}

function extractRound(suffixAfterCode) {
  const m = suffixAfterCode.match(/^R(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function toUnit(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function toBigInt(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeImpliedFromQuote(yesBid, yesAsk, last) {
  // Trust bid/ask midpoint ONLY when both sides have real liquidity:
  //   - both > 0 (someone actually wants to buy AND sell)
  //   - spread <= 10¢ (tight market — bid and ask agree)
  //   - ask < $1 (not a fully empty offer)
  // Without the yesBid>0 check, a stale dust ask (e.g. 0/1¢) tricks the
  // midpoint into reading 0.5% on a market that last traded at 58%.
  if (yesBid != null && yesAsk != null
      && yesBid > 0 && yesAsk > yesBid
      && yesAsk - yesBid <= 0.1 && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
  // Otherwise prefer last trade — it's what users actually paid most recently
  if (last != null && last > 0 && last < 1) return last;
  // Last resort: midpoint of whatever (one-sided) book is left
  if (yesBid != null && yesAsk != null && yesAsk < 1) {
    return Number(((yesBid + yesAsk) / 2).toFixed(4));
  }
  return null;
}

async function fetchJSON(url, attempt = 0) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (r.status === 429 && attempt < 4) {
    const wait = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s
    await new Promise((res) => setTimeout(res, wait));
    return fetchJSON(url, attempt + 1);
  }
  if (!r.ok) throw new Error(`Kalshi ${r.status} ${url}: ${await r.text().catch(() => "")}`);
  return r.json();
}

// Throttled Promise.all — limit concurrency so we stay under Kalshi's 20 req/sec.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function listEventsForSeries(seriesTicker) {
  const events = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/events`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON(url.toString());
    events.push(...(data.events || []));
    cursor = data.cursor || null;
  } while (cursor);
  return events;
}

async function fetchMarketsForEvent(eventTicker) {
  const markets = [];
  let cursor = null;
  do {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("event_ticker", eventTicker);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON(url.toString());
    markets.push(...(data.markets || []));
    cursor = data.cursor || null;
  } while (cursor);
  return markets;
}

// Process per-golfer binary series, batched.
async function ingestBinarySeries(supabase, series) {
  // 1) Fetch events + markets in parallel
  const events = await listEventsForSeries(series.ticker);
  if (!events.length) return { quotes: 0, errors: 0 };
  // Throttle to ~10 concurrent fetches to stay under Kalshi's 20 req/sec limit
  const eventsWithMarkets = await mapLimit(events, 10, async (e) => ({
    event: e,
    markets: await fetchMarketsForEvent(e.event_ticker),
  }));

  // 2) Upsert tournaments (winner series only) OR look up existing
  let tournamentByTicker = new Map();
  if (series.isWinner) {
    const rows = events.map((e) => {
      const name = canonicalTournamentName(e.title || e.sub_title || e.event_ticker);
      const year = new Date().getUTCFullYear();
      return {
        tour: "pga",
        name,
        short_name: e.sub_title || null,
        kalshi_event_ticker: e.event_ticker,
        season_year: year,
        slug: slugifyKalshi(name),
        status: "upcoming",
      };
    });
    const { data, error } = await supabase
      .from("golfodds_tournaments")
      .upsert(rows, { onConflict: "kalshi_event_ticker" })
      .select("id, kalshi_event_ticker");
    if (error) throw new Error(`upsert tournaments: ${error.message}`);
    tournamentByTicker = new Map(data.map((t) => [t.kalshi_event_ticker, t.id]));
  } else {
    // Non-winner series: link by suffix to existing winner tournament
    const suffixes = events.map((e) => tournamentSuffix(e.event_ticker));
    const { data, error } = await supabase
      .from("golfodds_tournaments")
      .select("id, kalshi_event_ticker")
      .like("kalshi_event_ticker", "KXPGATOUR-%");
    if (error) throw new Error(`load tournaments: ${error.message}`);
    const codeToId = new Map();
    for (const t of data || []) codeToId.set(t.kalshi_event_ticker.replace(/^KXPGATOUR-/, ""), t.id);
    for (let i = 0; i < events.length; i++) {
      const codes = Array.from(codeToId.keys()).sort((a, b) => b.length - a.length);
      const code = codes.find((c) => suffixes[i].startsWith(c));
      if (code) tournamentByTicker.set(events[i].event_ticker, codeToId.get(code));
    }
  }

  // 3) Collect unique players
  const playerMap = new Map(); // normalized_name -> { name, normalized_name }
  for (const { markets } of eventsWithMarkets) {
    for (const m of markets) {
      const name = (m.yes_sub_title || m.subtitle || m.title || "").trim();
      if (!name || name.length > 40) continue;
      if (/\b(rain|weather|cut\s*line|delay|playoff|margin|stroke|hole|score)\b/i.test(name)) continue;
      const norm = normalizeName(name);
      if (!playerMap.has(norm)) playerMap.set(norm, { name, normalized_name: norm, slug: slugifyKalshi(name) });
    }
  }
  let playerIdByNorm = new Map();
  if (playerMap.size > 0) {
    // Batch upsert in chunks of 500
    const rows = Array.from(playerMap.values());
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase
        .from("golfodds_players")
        .upsert(rows.slice(i, i + 500), { onConflict: "normalized_name" })
        .select("id, normalized_name");
      if (error) throw new Error(`upsert players: ${error.message}`);
      for (const p of data) playerIdByNorm.set(p.normalized_name, p.id);
    }
  }

  // 4) Build market rows + upsert
  const marketRows = [];
  const marketKey = (tid, pid) => `${tid}|${pid}|${series.marketType}`;
  const seenMarketKeys = new Set();
  for (const { event, markets } of eventsWithMarkets) {
    const tid = tournamentByTicker.get(event.event_ticker);
    if (!tid) continue;
    for (const m of markets) {
      const name = (m.yes_sub_title || m.subtitle || m.title || "").trim();
      if (!name) continue;
      const pid = playerIdByNorm.get(normalizeName(name));
      if (!pid) continue;
      const k = marketKey(tid, pid);
      if (seenMarketKeys.has(k)) continue;
      seenMarketKeys.add(k);
      marketRows.push({ tournament_id: tid, player_id: pid, market_type: series.marketType });
    }
  }
  const marketIdByKey = new Map();
  for (let i = 0; i < marketRows.length; i += 500) {
    const { data, error } = await supabase
      .from("golfodds_markets")
      .upsert(marketRows.slice(i, i + 500), { onConflict: "tournament_id,player_id,market_type" })
      .select("id, tournament_id, player_id, market_type");
    if (error) throw new Error(`upsert markets: ${error.message}`);
    for (const mm of data) marketIdByKey.set(`${mm.tournament_id}|${mm.player_id}|${mm.market_type}`, mm.id);
  }

  // 5) Build quote rows + bulk insert
  const quoteRows = [];
  for (const { event, markets } of eventsWithMarkets) {
    const tid = tournamentByTicker.get(event.event_ticker);
    if (!tid) continue;
    for (const m of markets) {
      const name = (m.yes_sub_title || m.subtitle || m.title || "").trim();
      if (!name) continue;
      const pid = playerIdByNorm.get(normalizeName(name));
      if (!pid) continue;
      const mid = marketIdByKey.get(`${tid}|${pid}|${series.marketType}`);
      if (!mid) continue;
      const yesBid = toUnit(m.yes_bid_dollars ?? m.yes_bid);
      const yesAsk = toUnit(m.yes_ask_dollars ?? m.yes_ask);
      const last = toUnit(m.last_price_dollars ?? m.last_price);
      quoteRows.push({
        market_id: mid,
        kalshi_ticker: m.ticker,
        yes_bid: yesBid,
        yes_ask: yesAsk,
        last_price: last,
        implied_prob: computeImpliedFromQuote(yesBid, yesAsk, last),
        volume: toBigInt(m.volume ?? m.volume_24h),
        open_interest: toBigInt(m.open_interest_fp ?? m.open_interest),
        status: m.status || null,
      });
    }
  }
  let inserted = 0;
  for (let i = 0; i < quoteRows.length; i += 1000) {
    const { error } = await supabase.from("golfodds_kalshi_quotes").insert(quoteRows.slice(i, i + 1000));
    if (error) throw new Error(`insert quotes: ${error.message}`);
    inserted += Math.min(1000, quoteRows.length - i);
  }
  return { quotes: inserted, errors: 0 };
}

// Matchup series — same general pattern but two/three players per event
async function ingestMatchupSeries(supabase, series) {
  const events = await listEventsForSeries(series.ticker);
  if (!events.length) return { quotes: 0 };
  // Throttle to ~10 concurrent fetches to stay under Kalshi's 20 req/sec limit
  const eventsWithMarkets = await mapLimit(events, 10, async (e) => ({
    event: e,
    markets: await fetchMarketsForEvent(e.event_ticker),
  }));

  // Load tournament map
  const { data: tdata } = await supabase
    .from("golfodds_tournaments")
    .select("id, kalshi_event_ticker")
    .like("kalshi_event_ticker", "KXPGATOUR-%");
  const codeToTid = new Map();
  for (const t of tdata || []) codeToTid.set(t.kalshi_event_ticker.replace(/^KXPGATOUR-/, ""), t.id);

  // Collect players
  const playerMap = new Map();
  for (const { markets } of eventsWithMarkets) {
    for (const m of markets) {
      const sub = m.yes_sub_title || "";
      const i = sub.toLowerCase().indexOf(" beats ");
      if (i < 0) continue;
      const name = sub.slice(0, i).trim();
      if (!name) continue;
      const norm = normalizeName(name);
      if (!playerMap.has(norm)) playerMap.set(norm, { name, normalized_name: norm, slug: slugifyKalshi(name) });
    }
  }
  const playerIdByNorm = new Map();
  if (playerMap.size > 0) {
    const rows = Array.from(playerMap.values());
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase
        .from("golfodds_players")
        .upsert(rows.slice(i, i + 500), { onConflict: "normalized_name" })
        .select("id, normalized_name");
      if (error) throw new Error(`matchup players upsert: ${error.message}`);
      for (const p of data) playerIdByNorm.set(p.normalized_name, p.id);
    }
  }

  // Upsert matchups
  const matchupRows = [];
  const eventToMatchupKey = new Map();
  for (const { event } of eventsWithMarkets) {
    const suffix = tournamentSuffix(event.event_ticker);
    const codes = Array.from(codeToTid.keys()).sort((a, b) => b.length - a.length);
    const code = codes.find((c) => suffix.startsWith(c));
    if (!code) continue;
    const tail = suffix.slice(code.length);
    const round = series.scope === "round" ? extractRound(tail) : null;
    matchupRows.push({
      tournament_id: codeToTid.get(code),
      matchup_type: series.matchupType,
      scope: series.scope,
      round_number: round,
      kalshi_event_ticker: event.event_ticker,
      title: event.title || null,
    });
    eventToMatchupKey.set(event.event_ticker, event.event_ticker);
  }
  const matchupIdByTicker = new Map();
  for (let i = 0; i < matchupRows.length; i += 500) {
    const { data, error } = await supabase
      .from("golfodds_matchups")
      .upsert(matchupRows.slice(i, i + 500), { onConflict: "kalshi_event_ticker" })
      .select("id, kalshi_event_ticker");
    if (error) throw new Error(`upsert matchups: ${error.message}`);
    for (const mm of data) matchupIdByTicker.set(mm.kalshi_event_ticker, mm.id);
  }

  // Upsert matchup_players
  const mpRows = [];
  for (const { event, markets } of eventsWithMarkets) {
    const matchupId = matchupIdByTicker.get(event.event_ticker);
    if (!matchupId) continue;
    for (const m of markets) {
      const sub = m.yes_sub_title || "";
      const i = sub.toLowerCase().indexOf(" beats ");
      if (i < 0) continue;
      const name = sub.slice(0, i).trim();
      if (!name) continue;
      const pid = playerIdByNorm.get(normalizeName(name));
      if (!pid) continue;
      mpRows.push({ matchup_id: matchupId, player_id: pid, kalshi_ticker: m.ticker });
    }
  }
  const mpIdByKey = new Map(); // (matchup_id|player_id) -> id
  for (let i = 0; i < mpRows.length; i += 500) {
    const { data, error } = await supabase
      .from("golfodds_matchup_players")
      .upsert(mpRows.slice(i, i + 500), { onConflict: "matchup_id,player_id" })
      .select("id, matchup_id, player_id");
    if (error) throw new Error(`upsert matchup_players: ${error.message}`);
    for (const mp of data) mpIdByKey.set(`${mp.matchup_id}|${mp.player_id}`, mp.id);
  }

  // Insert quotes
  const quoteRows = [];
  for (const { event, markets } of eventsWithMarkets) {
    const matchupId = matchupIdByTicker.get(event.event_ticker);
    if (!matchupId) continue;
    for (const m of markets) {
      const sub = m.yes_sub_title || "";
      const i = sub.toLowerCase().indexOf(" beats ");
      if (i < 0) continue;
      const name = sub.slice(0, i).trim();
      if (!name) continue;
      const pid = playerIdByNorm.get(normalizeName(name));
      if (!pid) continue;
      const mpId = mpIdByKey.get(`${matchupId}|${pid}`);
      if (!mpId) continue;
      const yesBid = toUnit(m.yes_bid_dollars);
      const yesAsk = toUnit(m.yes_ask_dollars);
      const last = toUnit(m.last_price_dollars);
      quoteRows.push({
        matchup_player_id: mpId,
        yes_bid: yesBid,
        yes_ask: yesAsk,
        last_price: last,
        implied_prob: computeImpliedFromQuote(yesBid, yesAsk, last),
        volume: toBigInt(m.volume),
        open_interest: toBigInt(m.open_interest_fp),
        status: m.status || null,
      });
    }
  }
  let inserted = 0;
  for (let i = 0; i < quoteRows.length; i += 1000) {
    const { error } = await supabase.from("golfodds_matchup_kalshi_quotes").insert(quoteRows.slice(i, i + 1000));
    if (error) throw new Error(`insert matchup quotes: ${error.message}`);
    inserted += Math.min(1000, quoteRows.length - i);
  }
  return { quotes: inserted };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  // Insert a cron_runs start row
  const { data: runRow, error: runErr } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-ingest-kalshi", started_at: startedAt })
    .select("id")
    .single();
  if (runErr) console.warn(`cron_runs insert failed: ${runErr.message}`);

  let totalQuotes = 0;
  let totalErrors = 0;
  const summary = {};

  for (const series of KALSHI_SERIES) {
    try {
      const r = await ingestBinarySeries(supabase, series);
      summary[series.ticker] = r.quotes;
      totalQuotes += r.quotes;
    } catch (e) {
      totalErrors++;
      summary[series.ticker] = { error: e.message };
    }
  }

  for (const series of KALSHI_MATCHUP_SERIES) {
    try {
      const r = await ingestMatchupSeries(supabase, series);
      summary[series.ticker] = r.quotes;
      totalQuotes += r.quotes;
    } catch (e) {
      totalErrors++;
      summary[series.ticker] = { error: e.message };
    }
  }

  if (runRow?.id) {
    await supabase
      .from("golfodds_cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_inserted: totalQuotes,
        errors: totalErrors,
        notes: JSON.stringify(summary),
      })
      .eq("id", runRow.id);
  }

  await supabase
    .from("golfodds_data_sources")
    .update({ last_import: new Date().toISOString(), record_count: totalQuotes })
    .eq("name", "kalshi");

  // Ping IndexNow about any tournaments newly inserted in the last 15 min.
  // Best-effort; failure must not break the cron.
  let indexnowSummary = null;
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: fresh } = await supabase
      .from("golfodds_tournaments")
      .select("slug, season_year, created_at")
      .gte("created_at", cutoff)
      .not("slug", "is", null);
    const urls = (fresh || [])
      .filter((t) => t.slug && t.season_year)
      .map((t) => `https://sportsbookish.com/golf/${t.season_year}/${t.slug}`);
    if (urls.length) {
      const r = await fetch("https://api.indexnow.org/IndexNow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: "sportsbookish.com",
          key: "620c7d50b41090ac7f0493e654f3219c",
          keyLocation: "https://sportsbookish.com/620c7d50b41090ac7f0493e654f3219c.txt",
          urlList: urls.slice(0, 10000),
        }),
      });
      indexnowSummary = { submitted: Math.min(urls.length, 10000), status: r.status };
    } else {
      indexnowSummary = { submitted: 0, reason: "no new tournaments" };
    }
  } catch (e) {
    indexnowSummary = { error: e.message };
  }

  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_quotes: totalQuotes,
    errors: totalErrors,
    by_series: summary,
    indexnow: indexnowSummary,
  });
}
