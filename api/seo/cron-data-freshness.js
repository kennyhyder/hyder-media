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
  // Golf — Kalshi
  { table: "golfodds_kalshi_latest", column: "fetched_at", label: "Golf Kalshi quotes", cron_minutes: 5, stale_after_minutes: 20 },
  // Golf — DataGolf model
  { table: "golfodds_dg_latest", column: "fetched_at", label: "Golf DataGolf model", cron_minutes: 10, stale_after_minutes: 40 },
  // Golf — sportsbooks (via DataGolf)
  { table: "golfodds_book_latest", column: "fetched_at", label: "Golf book quotes", cron_minutes: 10, stale_after_minutes: 40 },
  // Golf — Polymarket
  { table: "golfodds_polymarket_latest", column: "fetched_at", label: "Golf Polymarket quotes", cron_minutes: 15, stale_after_minutes: 60 },
  // Sports alerts (movement detector)
  { table: "sports_alerts", column: "fired_at", label: "Sports movement alerts", cron_minutes: 5, stale_after_minutes: 60 /* alerts are episodic, not constant */ },
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function checkOne(supabase, target) {
  const { data, error } = await supabase
    .from(target.table)
    .select(target.column)
    .order(target.column, { ascending: false })
    .limit(1);
  if (error) return { ...target, error: error.message };
  const latest = data?.[0]?.[target.column] || null;
  if (!latest) return { ...target, latest: null, status: "no_data" };
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
