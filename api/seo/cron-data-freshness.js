import { createClient } from "@supabase/supabase-js";

// Data-freshness canary. Every 15 min, checks the latest write timestamp
// on every critical ingest table. If a table hasn't received fresh data
// for >cron_cycle × 3, raises an alert.
//
// This is the complement to the route canary. The route canary catches
// "URL returns wrong status code"; the freshness canary catches "URL
// returns 200 but data hasn't moved in hours." Both are needed.
//
// Latest write is checked via:
//   SELECT MAX(fetched_at) FROM <table>
// which is O(1) on every fresh_at-indexed table.
//
// Alerts via Resend on second consecutive failure of the same table to
// avoid transient alert spam.
//
// GET /api/seo/cron-data-freshness
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 30 };

const SITE = "https://sportsbookish.com";
const ALERT_TO = "kenny@hyder.me";

// One row per ingest pipeline. cron_minutes is the expected schedule.
// stale_after_minutes is the alarm threshold (typically 3× cron_minutes
// to absorb one missed cycle + processing lag).
const FRESHNESS_TARGETS = [
  // Sports — Kalshi
  { table: "sports_quotes", column: "fetched_at", label: "Sports Kalshi quotes", cron_minutes: 5, stale_after_minutes: 20 },
  // Sports — sportsbooks (Odds API)
  { table: "sports_book_quotes", column: "fetched_at", label: "Sports book quotes (h2h)", cron_minutes: 30, stale_after_minutes: 120 },
  // Sports — Polymarket
  { table: "sports_polymarket_quotes", column: "fetched_at", label: "Sports Polymarket quotes", cron_minutes: 15, stale_after_minutes: 60 },
  // Golf — Kalshi. Heartbeat-gated: markets settle at tournament end and next
  // week's may not list until Mon/Tue. The ingest cron writes
  // golfodds_ingest_state after every run; when it's running clean with zero
  // open markets, staleness here is expected — suppress. A dead cron writes no
  // heartbeat, so the gate fails closed and the alert still fires.
  { table: "golfodds_kalshi_latest", column: "fetched_at", label: "Golf Kalshi quotes", cron_minutes: 5, stale_after_minutes: 20,
    skipUnless: kalshiExpectingData },
  // Golf — DataGolf model
  { table: "golfodds_dg_latest", column: "fetched_at", label: "Golf DataGolf model", cron_minutes: 10, stale_after_minutes: 40 },
  // Golf — sportsbooks (via DataGolf)
  { table: "golfodds_book_latest", column: "fetched_at", label: "Golf book quotes", cron_minutes: 10, stale_after_minutes: 40 },
  // Golf — Polymarket. Tournament-gated: Polymarket only opens tournament-level
  // win/top5/top10/top20 markets ~3-5 days before an event and closes them
  // after. Between tournaments (gaps of 1-2 weeks happen) there is genuinely
  // no data to ingest. The `skipUnless` predicate suppresses the check when
  // no open/upcoming tournament is within the coverage window.
  {
    table: "golfodds_polymarket_latest",
    column: "fetched_at",
    label: "Golf Polymarket quotes",
    cron_minutes: 15,
    stale_after_minutes: 60,
    skipUnless: hasActiveGolfTournament,
  },
  // GridCensus (own Supabase project — envUrl/envKey point the check there).
  // Cadences: sources refresh quarterly-ish (90d runbook); rescore rides refreshes.
  { table: "grid_data_sources", column: "last_import", label: "GridCensus source refreshes", cron_minutes: 129600, stale_after_minutes: 136800,
    envUrl: "GRIDCENSUS_SUPABASE_URL", envKey: "GRIDCENSUS_SUPABASE_SERVICE_KEY" },
  { table: "grid_dc_sites", column: "updated_at", label: "GridCensus site rescore", cron_minutes: 129600, stale_after_minutes: 144000,
    envUrl: "GRIDCENSUS_SUPABASE_URL", envKey: "GRIDCENSUS_SUPABASE_SERVICE_KEY" },
  // Sports alerts (movement detector)
  { table: "sports_alerts", column: "fired_at", label: "Sports movement alerts", cron_minutes: 5, stale_after_minutes: 60 /* alerts are episodic, not constant */ },
  // Dunham bail-keyword GSC snapshots (daily cron 13:10 UTC; GSC access granted 2026-07)
  { table: "dunham_bail_rank_history", column: "created_at", label: "Dunham bail rank snapshots", cron_minutes: 1440, stale_after_minutes: 4320 },
  // ── Census Fleet (each property = own Supabase project; refreshed by droplet
  // crons via /opt/census-fleet/ops/refresh-runner.sh, which also reports every
  // run to Mission Control mc_ingest_runs). stale_after = 3× refresh cadence,
  // except panel/well (annual/manual sources — ~400d per panelcensus README).
  { table: "cc_stations", column: "fetched_at", label: "ChargeCensus AFDC stations", cron_minutes: 10080, stale_after_minutes: 30240,
    envUrl: "CHARGECENSUS_SUPABASE_URL", envKey: "CHARGECENSUS_SUPABASE_SERVICE_KEY",
    allowEmpty: true /* NREL AFDC outage — initial load hasn't landed; remove once cc_stations populates so emptiness alerts again */ },
  { table: "tc_structures", column: "fetched_at", label: "TowerCensus FCC ASR structures", cron_minutes: 10080, stale_after_minutes: 30240,
    envUrl: "TOWERCENSUS_SUPABASE_URL", envKey: "TOWERCENSUS_SUPABASE_SERVICE_KEY" },
  { table: "cr_carriers", column: "fetched_at", label: "CarrierCensus FMCSA carriers", cron_minutes: 43200, stale_after_minutes: 129600,
    envUrl: "CARRIERCENSUS_SUPABASE_URL", envKey: "CARRIERCENSUS_SUPABASE_SERVICE_KEY" },
  { table: "ac_water_systems", column: "fetched_at", label: "AquaCensus EPA SDWA systems", cron_minutes: 129600, stale_after_minutes: 388800,
    envUrl: "AQUACENSUS_SUPABASE_URL", envKey: "AQUACENSUS_SUPABASE_SERVICE_KEY" },
  { table: "bc_buildings", column: "fetched_at", label: "BuildingCensus benchmarking rows", cron_minutes: 43200, stale_after_minutes: 129600,
    envUrl: "BUILDINGCENSUS_SUPABASE_URL", envKey: "BUILDINGCENSUS_SUPABASE_SERVICE_KEY" },
  { table: "pc_installations", column: "fetched_at", label: "PanelCensus LBNL TTS installs", cron_minutes: 525600, stale_after_minutes: 576000,
    envUrl: "PANELCENSUS_SUPABASE_URL", envKey: "PANELCENSUS_SUPABASE_SERVICE_KEY" },
  { table: "wc_wells", column: "fetched_at", label: "WellCensus state well registries", cron_minutes: 525600, stale_after_minutes: 576000,
    envUrl: "WELLCENSUS_SUPABASE_URL", envKey: "WELLCENSUS_SUPABASE_SERVICE_KEY" },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// Returns true when there's an open or imminent golf tournament where
// Polymarket coverage is expected. "Imminent" = within 5 days; Polymarket
// typically opens tournament markets ~3-5 days before play begins.
// True when the Kalshi check should run. False only when the ingest cron's
// heartbeat shows a recent clean run that found zero open markets (the
// between-tournaments window). Missing/stale heartbeat or errors => true.
async function kalshiExpectingData(supabase) {
  const { data, error } = await supabase
    .from("golfodds_ingest_state")
    .select("last_run_at, last_quotes, last_errors")
    .eq("source", "kalshi")
    .maybeSingle();
  if (error || !data) return true; // fail-closed: no heartbeat -> keep checking
  const ageMin = (Date.now() - new Date(data.last_run_at).getTime()) / 60000;
  const idleAndHealthy = ageMin <= 20 && data.last_quotes === 0 && data.last_errors === 0;
  return !idleAndHealthy;
}

async function hasActiveGolfTournament(supabase) {
  const horizonIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("golfodds_tournaments")
    .select("id")
    .in("status", ["open", "upcoming"])
    .gte("end_date", todayIso)
    .lte("start_date", horizonIso)
    .limit(1);
  if (error) return true; // fail-open: if the gate query breaks, keep checking
  return (data?.length || 0) > 0;
}

function clientFor(target) {
  if (target.envUrl && process.env[target.envUrl] && process.env[target.envKey]) {
    return createClient(process.env[target.envUrl].trim(), process.env[target.envKey].trim());
  }
  return null;
}

async function checkOne(supabase, target) {
  const override = clientFor(target);
  if (target.envUrl && !override) return { ...target, status: "skipped", skip_reason: "env_not_configured" };
  if (override) supabase = override;
  if (typeof target.skipUnless === "function") {
    const ok = await target.skipUnless(supabase);
    if (!ok) return { ...target, status: "skipped", skip_reason: "no_work_expected" };
  }
  const { data, error } = await supabase
    .from(target.table)
    .select(target.column)
    .order(target.column, { ascending: false })
    .limit(1);
  if (error) return { ...target, error: error.message };
  const latest = data?.[0]?.[target.column] || null;
  if (!latest) {
    // allowEmpty: table is known-empty (initial load pending) — report as skipped
    // instead of no_data so it doesn't page every 15 min while the source is down.
    if (target.allowEmpty) return { ...target, latest: null, status: "skipped", skip_reason: "table_empty_allowEmpty" };
    return { ...target, latest: null, status: "no_data" };
  }
  const ageMin = Math.round((Date.now() - new Date(latest).getTime()) / 60000);
  const status = ageMin > target.stale_after_minutes ? "stale" : "fresh";
  return { ...target, latest, age_minutes: ageMin, status };
}

async function sendAlert(stales) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const lines = stales.map((s) => `  ${s.label}: ${s.age_minutes} min old (threshold: ${s.stale_after_minutes} min) · table: ${s.table}`).join("\n");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SportsBookISH Canary <alerts@sportsbookish.com>",
      to: [ALERT_TO],
      subject: `🚨 SportsBookISH: ${stales.length} ingest pipeline${stales.length > 1 ? "s" : ""} stuck`,
      text: `Data has stopped flowing in:\n\n${lines}\n\nInvestigate immediately — ingest cron likely failing silently. Trigger manually: \nfor c in cron-ingest cron-ingest-books cron-ingest-polymarket cron-ingest-kalshi cron-ingest-datagolf cron-ingest-matchup-books; do\n  curl -H "Authorization: Bearer $CRON_SECRET" https://hyder.me/api/<path>/$c\ndone\n`,
    }),
  });
  return r.ok ? { ok: true } : { ok: false, error: `${r.status}` };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const results = await Promise.all(FRESHNESS_TARGETS.map((t) => checkOne(supabase, t)));
  const stales = results.filter((r) => r.status === "stale" || r.status === "no_data" || r.error);

  // Log
  await supabase.from("sb_data_freshness_log").insert({
    checked_at: startedAt,
    total: results.length,
    stales: stales.length,
    detail: results,
  }).then(() => null, () => null);

  // Alert on second consecutive failure of the same table
  let alerted = false;
  if (stales.length > 0) {
    const { data: prior } = await supabase
      .from("sb_data_freshness_log")
      .select("detail")
      .order("checked_at", { ascending: false })
      .range(1, 1)
      .maybeSingle();
    const priorStales = new Set(
      ((prior?.detail || []).filter((d) => d.status === "stale" || d.status === "no_data" || d.error)).map((d) => d.table)
    );
    const repeats = stales.filter((s) => priorStales.has(s.table));
    if (repeats.length > 0) {
      const sent = await sendAlert(repeats);
      alerted = sent.ok;
    }
  }

  return res.status(200).json({
    checked_at: startedAt,
    total: results.length,
    stales: stales.length,
    alerted,
    detail: results,
  });
}
