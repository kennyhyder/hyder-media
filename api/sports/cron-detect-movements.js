import { getSupabase, checkAuth } from "./_lib.js";

// Movement alerts — works for any Kalshi sport, doesn't need book data.
// Compares the current quote to the quote ~15 min ago. If the price moved
// >= MOVEMENT_THRESHOLD, fire an alert (dedup'd against recent alerts on
// the same market+direction).
//
// Cron: every 5 min, scans all open events with recent quote activity.

const MOVEMENT_THRESHOLD = 0.03;   // 3% move in 15 min
const LOOKBACK_MIN = 15;
const DEDUP_MIN = 30;

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const { data: runRow } = await supabase
    .from("golfodds_cron_runs")
    .insert({ job_name: "cron-detect-movements", started_at: startedAt })
    .select("id").single();

  // For each open event, get markets, get latest quote + quote ~LOOKBACK_MIN ago,
  // compare. We use the latest view + range query into raw quotes.
  const { data: events } = await supabase
    .from("sports_events")
    .select("id, league, event_type, title")
    .eq("status", "open")
    .range(0, 9999);
  if (!events?.length) return res.status(200).json({ new_alerts: 0 });

  const eventIds = events.map((e) => e.id);
  const eventById = new Map(events.map((e) => [e.id, e]));

  // Get all markets in open events
  const allMarkets = [];
  for (let i = 0; i < eventIds.length; i += 100) {
    const { data } = await supabase
      .from("sports_markets")
      .select("id, event_id, contestant_label")
      .in("event_id", eventIds.slice(i, i + 100));
    if (data) allMarkets.push(...data);
  }
  if (!allMarkets.length) return res.status(200).json({ new_alerts: 0 });

  const marketIds = allMarkets.map((m) => m.id);
  const marketById = new Map(allMarkets.map((m) => [m.id, m]));

  // Latest quote per market
  const latestRows = [];
  for (let i = 0; i < marketIds.length; i += 100) {
    const { data } = await supabase
      .from("sports_v_latest_quotes")
      .select("market_id, implied_prob, fetched_at")
      .in("market_id", marketIds.slice(i, i + 100));
    if (data) latestRows.push(...data);
  }
  const latestByMarket = new Map(latestRows.map((r) => [r.market_id, r]));

  // Baseline quote ~15min ago: fetch raw quotes in window, take oldest per market
  const lookbackStart = new Date(Date.now() - (LOOKBACK_MIN + 5) * 60_000).toISOString();
  const lookbackEnd = new Date(Date.now() - LOOKBACK_MIN * 60_000).toISOString();
  const baselineRows = [];
  for (let i = 0; i < marketIds.length; i += 100) {
    const { data } = await supabase
      .from("sports_quotes")
      .select("market_id, implied_prob, fetched_at")
      .in("market_id", marketIds.slice(i, i + 100))
      .gte("fetched_at", lookbackStart)
      .lte("fetched_at", lookbackEnd)
      .order("fetched_at", { ascending: true })
      .range(0, 9999);
    if (data) baselineRows.push(...data);
  }
  const baselineByMarket = new Map();
  for (const r of baselineRows) {
    if (!baselineByMarket.has(r.market_id)) baselineByMarket.set(r.market_id, r);
  }

  // Recent alerts (dedup window)
  const dedupCutoff = new Date(Date.now() - DEDUP_MIN * 60_000).toISOString();
  const { data: recentAlerts } = await supabase
    .from("sports_alerts")
    .select("market_id, direction, fired_at")
    .gte("fired_at", dedupCutoff);
  const recentKey = new Set((recentAlerts || []).map((a) => `${a.market_id}|${a.direction}`));

  // Detect movements
  const newAlerts = [];
  for (const market of allMarkets) {
    const now = latestByMarket.get(market.id);
    const base = baselineByMarket.get(market.id);
    if (!now || !base || now.implied_prob == null || base.implied_prob == null) continue;
    const delta = now.implied_prob - base.implied_prob;
    if (Math.abs(delta) < MOVEMENT_THRESHOLD) continue;
    const direction = delta > 0 ? "up" : "down";
    const key = `${market.id}|${direction}`;
    if (recentKey.has(key)) continue;
    recentKey.add(key);

    const event = eventById.get(market.event_id);
    newAlerts.push({
      league: event.league,
      event_id: market.event_id,
      market_id: market.id,
      alert_type: "movement",
      direction,
      delta: Number(delta.toFixed(4)),
      kalshi_prob_now: now.implied_prob,
      kalshi_prob_baseline: base.implied_prob,
      baseline_minutes_ago: LOOKBACK_MIN,
    });
  }

  let inserted = 0;
  if (newAlerts.length) {
    const { error } = await supabase.from("sports_alerts").insert(newAlerts);
    if (!error) inserted = newAlerts.length;
  }

  if (runRow?.id) {
    await supabase.from("golfodds_cron_runs").update({
      finished_at: new Date().toISOString(),
      rows_inserted: inserted,
      errors: 0,
      notes: JSON.stringify({ scanned: allMarkets.length, fired: inserted }),
    }).eq("id", runRow.id);
  }

  return res.status(200).json({
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    scanned: allMarkets.length,
    new_alerts: inserted,
  });
}
