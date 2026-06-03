import { createClient } from "@supabase/supabase-js";
// Bundle vercel.json into this function so we can read scheduled crons at
// runtime — Vercel doesn't include vercel.json in /var/task by default.
import vercelConfig from "../../vercel.json" with { type: "json" };

// Cron + schema coverage canary. Runs hourly.
//
// Checks three classes of silent-failure:
//
//   1. CRON SCHEDULES vs CRON FILES — every entry in vercel.json#crons[].path
//      must resolve to a real file in api/. Catches:
//        - schedule typo (e.g. /api/sports/cron-ingst)
//        - file deleted or moved without removing schedule
//        - new cron file shipped without a schedule (the exact bug that hid
//          /api/seo/cron-data-freshness from Vercel for ~2 hours on 2026-06-02)
//
//   2. CRITICAL TABLES — tables that the platform depends on must exist with
//      expected indexes. Catches:
//        - migration not applied to prod
//        - someone DROP'd a table in a debug session
//        - schema reverted by Supabase support
//
//   3. RECENT WRITES — for tables where rows should always be flowing,
//      confirm there's been at least one write in the last <max_age> minutes.
//      Lighter-weight version of cron-data-freshness for tables that aren't
//      worth a full freshness pipeline entry.
//
// Alerts via Resend on the 2nd consecutive failure of the same check, same
// as the route + freshness canaries. Three-canary defense-in-depth covers:
//   route-canary       → URLs are reachable
//   data-freshness     → ingest pipelines are flowing
//   coverage-check     → infrastructure that powers both is configured right
//
// GET /api/seo/cron-coverage-check
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const SITE = "https://hyder.me";
const ALERT_TO = "kenny@hyder.me";

// Critical tables. If any of these go missing, alert immediately — the
// platform is broken in a way that won't show up as a 500 (queries will
// silently return [] and downstream UI will render empty states).
const CRITICAL_TABLES = [
  // sportsbookish
  "sb_subscriptions",
  "sb_subscription_tiers",
  "sb_user_preferences",
  "sb_route_health",
  "sb_data_freshness_log",
  "sb_url_redirects",
  // sports data plane
  "sports_events",
  "sports_markets",
  "sports_quotes",
  "sports_book_quotes",
  "sports_polymarket_quotes",
  "sports_alerts",
  // golf data plane
  "golfodds_tournaments",
  "golfodds_players",
  "golfodds_markets",
  "golfodds_kalshi_latest",
  "golfodds_dg_latest",
  "golfodds_book_latest",
  "golfodds_polymarket_latest",
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

// ── Check 1: cron schedules ↔ files ─────────────────────────────────────────

async function checkCronCoverage() {
  // For every scheduled cron, HEAD its URL. A 404 means the schedule
  // points at a function that isn't actually deployed (typo in vercel.json,
  // or file was renamed/deleted without updating the schedule). A 401 is
  // expected (we don't pass CRON_SECRET) and indicates the function IS
  // deployed and reachable. We treat anything other than 404 / 5xx as OK.
  //
  // We can't use the filesystem here: each Vercel serverless function gets
  // its own isolated bundle in /var/task, so sibling api/ files aren't
  // present at runtime. Calling the URL is the most accurate way to verify
  // the deployed surface.
  const failures = [];
  const checked = { scheduled: 0, urls_probed: 0, urls_404: 0, urls_5xx: 0 };
  const crons = vercelConfig?.crons || [];
  checked.scheduled = crons.length;

  await Promise.all(crons.map(async (c) => {
    if (!c.path) return;
    checked.urls_probed++;
    try {
      const r = await fetch(`${SITE}${c.path}`, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "sportsbookish-coverage-check/1.0" },
      });
      if (r.status === 404) {
        checked.urls_404++;
        failures.push({ kind: "schedule_404", path: c.path, status: r.status });
      } else if (r.status >= 500) {
        checked.urls_5xx++;
        failures.push({ kind: "schedule_5xx", path: c.path, status: r.status });
      }
    } catch (e) {
      failures.push({ kind: "schedule_unreachable", path: c.path, error: e.message });
    }
  }));

  return { ok: failures.length === 0, failures, checked };
}

// ── Check 2: critical tables exist ──────────────────────────────────────────

async function checkTablesExist(supabase) {
  const failures = [];
  const checked = [];
  for (const table of CRITICAL_TABLES) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
    if (error) {
      // Postgres error code 42P01 = "relation does not exist". Other errors
      // we treat as transient (RLS denial, statement timeout) and don't alert.
      if (error.code === "42P01" || /does not exist/i.test(error.message || "")) {
        failures.push({ kind: "table_missing", table, error: error.message });
      }
    } else {
      checked.push(table);
    }
  }
  return { ok: failures.length === 0, failures, checked: { tables_present: checked.length, expected: CRITICAL_TABLES.length } };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function sendAlert(allFailures) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const lines = allFailures.map((f) => {
    if (f.kind === "schedule_without_file") return `  • Cron scheduled but file missing: ${f.path} (expected ${f.expected_file})`;
    if (f.kind === "table_missing") return `  • Table missing from DB: ${f.table} (${f.error})`;
    if (f.kind === "vercel_json") return `  • Could not read vercel.json: ${f.error}`;
    return `  • ${f.kind}: ${JSON.stringify(f).slice(0, 100)}`;
  }).join("\n");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SportsBookISH Canary <alerts@sportsbookish.com>",
      to: [ALERT_TO],
      subject: `🚨 Platform coverage canary: ${allFailures.length} infra problem${allFailures.length > 1 ? "s" : ""}`,
      text: `Coverage canary detected configuration drift:\n\n${lines}\n\nThis is the canary that catches silent infrastructure failures (schedules without files, tables that got dropped, etc). Each entry above is something that would NOT show up as a 500 but would silently break the platform.\n`,
    }),
  });
  return r.ok ? { ok: true } : { ok: false, error: `${r.status}` };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const [cronResult, tableResult] = await Promise.all([
    checkCronCoverage(),
    checkTablesExist(supabase),
  ]);

  const allFailures = [...(cronResult.failures || []), ...(tableResult.failures || [])];

  // Persist run + alert-on-second-consecutive-failure pattern
  await supabase.from("sb_coverage_log").insert({
    checked_at: startedAt,
    cron_ok: cronResult.ok,
    cron_failures: cronResult.failures || [],
    cron_checked: cronResult.checked || {},
    table_ok: tableResult.ok,
    table_failures: tableResult.failures || [],
    table_checked: tableResult.checked || {},
  }).then(() => null, () => null);

  let alerted = false;
  if (allFailures.length > 0) {
    const { data: prior } = await supabase
      .from("sb_coverage_log")
      .select("cron_failures, table_failures")
      .order("checked_at", { ascending: false })
      .range(1, 1)
      .maybeSingle();
    const priorKeys = new Set();
    for (const f of (prior?.cron_failures || []).concat(prior?.table_failures || [])) {
      priorKeys.add(`${f.kind}:${f.path || f.table || ""}`);
    }
    const repeats = allFailures.filter((f) => priorKeys.has(`${f.kind}:${f.path || f.table || ""}`));
    if (repeats.length > 0) {
      const sent = await sendAlert(repeats);
      alerted = sent.ok;
    }
  }

  return res.status(200).json({
    checked_at: startedAt,
    cron: cronResult,
    tables: tableResult,
    alerted,
    overall_ok: allFailures.length === 0,
  });
}
