import { createClient } from "@supabase/supabase-js";
import { normalizeName } from "./_lib.js";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Polymarket Gamma API — free, no auth required for reads.
// Docs: https://docs.polymarket.com/#gamma
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Polymarket tag IDs that correspond to our sports leagues (verified by manual
// query against /events?tag_id=NN). These can drift; check /tags if matching
// drops to zero.
const LEAGUE_TAGS = {
  nba: ["100036", "basketball"],       // NBA tag + fallback string tag
  mlb: ["100021", "mlb"],
  nhl: ["100025", "nhl"],
  epl: ["100029", "soccer", "epl"],
  mls: ["100029", "mls", "soccer"],
};

const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (req.query?.secret === process.env.CRON_SECRET) return true;
  return false;
}

async function fetchActivePolymarketEvents() {
  const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=500&order=startDate&ascending=true`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Polymarket ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

// Soft team-name match against a Kalshi contestant_label. Polymarket uses full
// team names ("New York Yankees"), Kalshi uses short forms ("New York Y").
// Direct equality first, then prefix and last-word matching.
function softLabelMatch(polyText, kalshiLabel) {
  if (!polyText || !kalshiLabel) return false;
  const p = normalizeName(polyText).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const k = normalizeName(kalshiLabel).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (p === k) return true;
  if (p.startsWith(k + " ") || k.startsWith(p + " ")) return true;
  if (p.endsWith(" " + k) || k.endsWith(" " + p)) return true;
  if (p.includes(" " + k + " ") || k.includes(" " + p + " ")) return true;
  const pLast = p.split(" ").pop();
  const kLast = k.split(" ").pop();
  if (pLast && kLast && pLast === kLast && pLast.length >= 4) return true;
  return false;
}

function extractTeamFromMarketQuestion(question) {
  // Polymarket market question is typically "Will the <team> win the <event>?".
  // Extract the team name in between "the " and " win".
  const m = question.match(/will\s+the\s+(.+?)\s+win\s+the/i);
  if (m) return m[1].trim();
  // Fallback for game-level questions: "<team> vs <team>"
  const m2 = question.match(/^(.+?)\s+(?:vs\.?|@)\s+(.+?)$/i);
  if (m2) return m2[1].trim();           // home team
  return question;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = Date.now();

  // 1. Load all open Kalshi events + markets for matching
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, title, start_time, league, event_type")
    .eq("status", "open");
  if (!events?.length) return res.status(200).json({ ok: true, skipped: "no open events" });

  const { data: markets } = await supabase
    .from("sports_markets")
    .select("id, event_id, contestant_label")
    .in("event_id", events.map((e) => e.id));

  const marketsByEvent = new Map();
  for (const m of markets || []) {
    const arr = marketsByEvent.get(m.event_id) || [];
    arr.push({ market_id: m.id, label: m.contestant_label });
    marketsByEvent.set(m.event_id, arr);
  }

  // 2. Fetch Polymarket active events
  let polyEvents;
  try {
    polyEvents = await fetchActivePolymarketEvents();
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }

  // 3. For each Polymarket event, try to match it to a Kalshi event and store
  // one quote per outcome (one team per market).
  const summary = {
    polymarket_events_returned: polyEvents.length,
    events_matched: 0,
    quotes_inserted: 0,
    samples_unmatched: [],
  };

  const newMapRows = [];
  const insertQuoteRows = [];
  const now = new Date().toISOString();

  for (const pe of polyEvents) {
    const peSlug = pe.slug;
    const peTitle = pe.title || "";
    const peStart = pe.startDate ? new Date(pe.startDate).getTime() : null;

    // Sports filter — heuristic: Polymarket category or tag includes a sport word
    const tagsLower = (pe.tags || []).map((t) => (typeof t === "string" ? t : t?.label || "").toLowerCase());
    const isSports = tagsLower.some((t) => ["sports", "basketball", "baseball", "hockey", "soccer", "golf", "nba", "mlb", "nhl", "epl", "mls", "pga"].some((s) => t.includes(s)))
      || /\b(nba|mlb|nhl|epl|mls|world series|stanley cup|champion|game \d|playoff|finals?)\b/i.test(peTitle);
    if (!isSports) continue;

    // Time window filter
    const candidates = peStart
      ? events.filter((e) => !e.start_time || Math.abs(new Date(e.start_time).getTime() - peStart) <= MATCH_WINDOW_MS)
      : events;

    // For each market on the polymarket event, see if its team matches one of our markets
    for (const pm of pe.markets || []) {
      const teamName = extractTeamFromMarketQuestion(pm.question || "");
      if (!teamName) continue;
      const outcomes = (() => {
        try { return JSON.parse(pm.outcomes || "[]"); } catch { return []; }
      })();
      const prices = (() => {
        try { return JSON.parse(pm.outcomePrices || "[]"); } catch { return []; }
      })();
      const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
      if (yesIdx === -1) continue;
      const yesPrice = Number(prices[yesIdx]);
      const noPrice = Number(prices[1 - yesIdx]);
      if (!Number.isFinite(yesPrice)) continue;

      // Find the Kalshi event whose markets contain this team
      let matchedEvent = null;
      let matchedMarket = null;
      for (const cand of candidates) {
        const mkts = marketsByEvent.get(cand.id) || [];
        const hit = mkts.find((m) => softLabelMatch(teamName, m.label));
        if (hit) { matchedEvent = cand; matchedMarket = hit; break; }
      }
      if (!matchedEvent) {
        if (summary.samples_unmatched.length < 5) {
          summary.samples_unmatched.push({ team: teamName, poly_event: peTitle });
        }
        continue;
      }

      newMapRows.push({
        polymarket_event_slug: peSlug,
        sports_event_id: matchedEvent.id,
        title: peTitle,
        start_time: pe.startDate || null,
        league: matchedEvent.league,
        matched_at: now,
        last_seen_at: now,
      });

      insertQuoteRows.push({
        sports_event_id: matchedEvent.id,
        polymarket_event_slug: peSlug,
        polymarket_condition_id: pm.conditionId || pm.condition_id || "",
        contestant_label: matchedMarket.label,
        contestant_norm: normalizeName(matchedMarket.label),
        yes_price: yesPrice,
        no_price: Number.isFinite(noPrice) ? noPrice : null,
        implied_prob: yesPrice,
        volume_usd: pm.volumeNum != null ? Number(pm.volumeNum) : null,
        fetched_at: now,
      });
    }
  }

  // De-dupe map rows
  const mapByKey = new Map();
  for (const row of newMapRows) mapByKey.set(row.polymarket_event_slug, row);
  const dedupedMap = Array.from(mapByKey.values());
  summary.events_matched = dedupedMap.length;

  if (dedupedMap.length) {
    const { error } = await supabase
      .from("sports_polymarket_events_map")
      .upsert(dedupedMap, { onConflict: "polymarket_event_slug" });
    if (error) summary.map_error = error.message;
  }

  for (let i = 0; i < insertQuoteRows.length; i += 500) {
    const slice = insertQuoteRows.slice(i, i + 500);
    const { error } = await supabase.from("sports_polymarket_quotes").insert(slice);
    if (error) { summary.quote_error = error.message; break; }
    summary.quotes_inserted += slice.length;
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    ...summary,
  });
}
