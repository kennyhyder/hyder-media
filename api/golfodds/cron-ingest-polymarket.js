import { createClient } from "@supabase/supabase-js";
import { resolveTournament } from "./_tournament_resolver.js";

// Polymarket golf ingester. Mirrors the sports ingester pattern but
// targets golf-tagged events and resolves each player market against
// existing golfodds_markets rows seeded by the Kalshi cron.
//
// Polymarket structure (golf tournaments):
//   Event:   "2026 the Memorial Tournament presented by Workday Winner"
//   Markets: "Will <Player> win the 2026 the Memorial Tournament...?"
//            "Will <Player> finish in the Top 5 at the 2026 the Memorial...?"
//
// Each tournament has 4 separate Polymarket "events", one per market_type
// (winner / top5 / top10 / top20). We iterate all golf-tagged Polymarket
// events, identify the market_type from the title suffix, resolve the
// tournament via the shared resolver, then match each player market to a
// golfodds_markets row by normalized player name.
//
// GET /api/golfodds/cron-ingest-polymarket
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const GAMMA_BASE = "https://gamma-api.polymarket.com";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (req.query?.secret === process.env.CRON_SECRET) return true;
  return false;
}

const normalizeName = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Pull the tournament name out of the Polymarket event title.
// "PGA Tour: the Memorial Tournament presented by Workday Winner" → strip prefix + suffix.
// "FedEx Cup Playoffs: Winner" → tournament not coverage we want; resolver will fail.
function eventTitleToTournamentName(title) {
  if (!title) return null;
  let t = title.replace(/^pga\s+tour:\s*/i, "");
  // Drop trailing market-type indicator
  t = t.replace(/\s+(winner|top\s*5|top\s*10|top\s*20|outright)\s*$/i, "");
  return t.trim();
}

// Determine market_type from event slug or title.
function detectMarketType(event) {
  const s = `${event.slug || ""} ${event.title || ""}`.toLowerCase();
  if (/\b(winner|outright)\b/.test(s) && !/top\s*\d/.test(s)) return "win";
  if (/top\s*5\b/.test(s)) return "top5";
  if (/top\s*10\b/.test(s)) return "top10";
  if (/top\s*20\b/.test(s)) return "top20";
  return null;
}

// Extract player name from a market question.
// "Will Scottie Scheffler win the 2026 Memorial..." → "Scottie Scheffler"
// "Will Ludvig Aberg finish in the Top 10 at the 2026..." → "Ludvig Aberg"
function extractPlayerName(question) {
  if (!question) return null;
  let m = question.match(/^will\s+(.+?)\s+win\s+the\b/i);
  if (m) return m[1].trim();
  m = question.match(/^will\s+(.+?)\s+finish\s+in\s+the\s+top\b/i);
  if (m) return m[1].trim();
  // Fallback: "Will <Player> ..."
  m = question.match(/^will\s+(.+?)\s+/i);
  if (m) return m[1].trim();
  return null;
}

function parseJsonArray(s) {
  if (Array.isArray(s)) return s;
  if (typeof s !== "string") return [];
  try { return JSON.parse(s); } catch { return []; }
}

async function fetchGolfEvents() {
  // Pull active+open golf-tagged events. tag_slug=golf is the verified filter.
  const url = `${GAMMA_BASE}/events?active=true&closed=false&tag_slug=golf&limit=100`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Polymarket ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = Date.now();

  let polyEvents;
  try {
    polyEvents = await fetchGolfEvents();
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }

  const summary = {
    polymarket_events_returned: polyEvents.length,
    events_matched: 0,
    quotes_inserted: 0,
    by_event: [],
    samples_unmatched_player: [],
  };

  const now = new Date().toISOString();
  const quoteRows = [];
  const mapRows = [];

  for (const pe of polyEvents) {
    const peSlug = pe.slug;
    const peTitle = pe.title || "";
    const marketType = detectMarketType(pe);
    const eventSummary = { slug: peSlug, title: peTitle, market_type: marketType, status: "skipped" };

    if (!marketType) {
      eventSummary.skip_reason = "no market_type";
      summary.by_event.push(eventSummary);
      continue;
    }

    const tournamentName = eventTitleToTournamentName(peTitle);
    if (!tournamentName) {
      eventSummary.skip_reason = "no tournament name";
      summary.by_event.push(eventSummary);
      continue;
    }

    // Match without auto-creating — golf tournaments must be seeded by Kalshi first
    const resolved = await resolveTournament(supabase, tournamentName, { allowCreate: false });
    if (!resolved.id) {
      eventSummary.skip_reason = resolved.reason || "tournament unresolved";
      eventSummary.tournament_name_tried = tournamentName;
      summary.by_event.push(eventSummary);
      continue;
    }

    // Load our markets for this (tournament, market_type) with the player rows
    const { data: ourMarkets, error: mErr } = await supabase
      .from("golfodds_markets")
      .select("id, golfodds_players(name, normalized_name)")
      .eq("tournament_id", resolved.id)
      .eq("market_type", marketType);
    if (mErr) { eventSummary.skip_reason = `select markets: ${mErr.message}`; summary.by_event.push(eventSummary); continue; }
    if (!ourMarkets?.length) {
      eventSummary.skip_reason = `no ${marketType} markets seeded yet`;
      summary.by_event.push(eventSummary);
      continue;
    }

    const ourByNorm = new Map();
    for (const m of ourMarkets) {
      const norm = m.golfodds_players?.normalized_name || normalizeName(m.golfodds_players?.name);
      if (norm) ourByNorm.set(norm, m.id);
    }

    let matchedInThisEvent = 0;
    let unmatchedInThisEvent = 0;

    for (const pm of pe.markets || []) {
      const playerName = extractPlayerName(pm.question);
      if (!playerName) continue;
      const norm = normalizeName(playerName);
      const marketId = ourByNorm.get(norm);
      if (!marketId) {
        unmatchedInThisEvent++;
        if (summary.samples_unmatched_player.length < 5) {
          summary.samples_unmatched_player.push({ tournament: tournamentName, market_type: marketType, player: playerName });
        }
        continue;
      }

      const outcomes = parseJsonArray(pm.outcomes);
      const prices = parseJsonArray(pm.outcomePrices);
      const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
      if (yesIdx === -1) continue;
      const yesPrice = Number(prices[yesIdx]);
      const noPrice = Number(prices[1 - yesIdx]);
      if (!Number.isFinite(yesPrice)) continue;

      quoteRows.push({
        market_id: marketId,
        polymarket_event_slug: peSlug,
        polymarket_condition_id: pm.conditionId || pm.condition_id || "",
        player_norm: norm,
        yes_price: Number(yesPrice.toFixed(5)),
        no_price: Number.isFinite(noPrice) ? Number(noPrice.toFixed(5)) : null,
        implied_prob: Number(yesPrice.toFixed(5)),
        volume_usd: pm.volumeNum != null ? Number(pm.volumeNum) : null,
        fetched_at: now,
      });
      matchedInThisEvent++;
    }

    if (matchedInThisEvent > 0) {
      summary.events_matched++;
      mapRows.push({
        polymarket_event_slug: peSlug,
        tournament_id: resolved.id,
        title: peTitle,
        start_time: pe.startDate || null,
        matched_at: now,
        last_seen_at: now,
      });
    }

    eventSummary.status = matchedInThisEvent > 0 ? "matched" : "no_player_matches";
    eventSummary.matched = matchedInThisEvent;
    eventSummary.unmatched = unmatchedInThisEvent;
    summary.by_event.push(eventSummary);
  }

  if (mapRows.length) {
    const { error } = await supabase
      .from("golfodds_polymarket_events_map")
      .upsert(mapRows, { onConflict: "polymarket_event_slug" });
    if (error) summary.map_error = error.message;
  }

  for (let i = 0; i < quoteRows.length; i += 500) {
    const slice = quoteRows.slice(i, i + 500);
    const { error } = await supabase.from("golfodds_polymarket_quotes").insert(slice);
    if (error) { summary.quote_error = error.message; break; }
    summary.quotes_inserted += slice.length;
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    ...summary,
  });
}
