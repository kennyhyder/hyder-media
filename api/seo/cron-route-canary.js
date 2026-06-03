import { createClient } from "@supabase/supabase-js";

// Live URL canary. Hits a curated set of known-good URLs every 15 min and
// alerts the moment any of them returns an unexpected status code. This is
// the safety net that would have caught the middleware-pattern bug from
// 2026-05-31 (3 days of every event page silently 301'd to its year archive)
// within minutes instead of after a manual smoke test.
//
// The canary set covers:
//   1. Static surfaces (home, pricing, sports hub, golf hub)
//   2. Every league hub
//   3. One known-live event detail per major league
//   4. One known-live tournament detail per active golf season
//   5. Programmatic surfaces (one /odds/[sport]/[market], one /sportsbooks/[slug])
//   6. Research, embeds, scanners, leaderboard
//
// Alerts via Resend email to kenny@hyder.me + writes to sb_route_health.
//
// GET /api/seo/cron-route-canary
//   Authorization: Bearer <CRON_SECRET>

export const config = { maxDuration: 60 };

const SITE = "https://sportsbookish.com";
const ALERT_TO = "kenny@hyder.me";

// Canaries — every URL must return 200. Add to this list whenever a new
// route shape ships. Sampled URLs (live event/tournament IDs) are pulled
// dynamically from the DB at runtime so they don't bit-rot.
const STATIC_CANARIES = [
  "/",
  "/sports",
  "/sports/nba", "/sports/mlb", "/sports/nfl", "/sports/nhl",
  "/sports/epl", "/sports/wc", "/sports/mls",
  "/sports/positive-ev", "/sports/arbitrage", "/sports/middles", "/sports/movers",
  "/sports/mlb/teams", "/sports/nba/players",
  "/golf", "/golf/players",
  "/sportsbooks", "/sportsbooks/draftkings", "/sportsbooks/kalshi-vs-fanduel",
  "/sportsbook-promos",
  "/odds/mlb/moneyline", "/odds/nfl/spread",
  "/research", "/research/why-mid-game-kalshi-lines-lag",
  "/clv-leaderboard", "/embed", "/embed/biggest-edges",
  "/pricing", "/learn/glossary", "/tools",
];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function sampleLiveSlugs(supabase) {
  // One live event per major league + one live tournament for golf.
  const out = [];
  const { data: events } = await supabase
    .from("sports_events")
    .select("league, season_year, slug")
    .eq("status", "open")
    .not("slug", "is", null)
    .not("season_year", "is", null)
    .in("league", ["nba", "mlb", "nfl", "nhl", "epl", "wc", "mls"])
    .order("start_time", { ascending: true })
    .limit(50);
  // First per league
  const seenLeagues = new Set();
  for (const e of events || []) {
    if (seenLeagues.has(e.league)) continue;
    seenLeagues.add(e.league);
    out.push(`/sports/${e.league}/${e.season_year}/${e.slug}`);
  }
  // Golf: one active tournament
  const { data: tour } = await supabase
    .from("golfodds_tournaments")
    .select("season_year, slug")
    .eq("status", "upcoming")
    .not("slug", "is", null)
    .order("end_date", { ascending: true })
    .limit(1);
  if (tour?.[0]) out.push(`/golf/${tour[0].season_year}/${tour[0].slug}`);
  return out;
}

async function fetchHead(url) {
  const start = Date.now();
  try {
    // Use GET (not HEAD) — Vercel's static optimization treats them
    // differently and we want the same code path real users hit.
    const r = await fetch(`${SITE}${url}`, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "sportsbookish-canary/1.0" },
    });
    return { url, status: r.status, location: r.headers.get("location") || null, ms: Date.now() - start };
  } catch (e) {
    return { url, status: 0, error: e.message || "fetch failed", ms: Date.now() - start };
  }
}

async function sendAlert(failures) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };
  const summary = failures.map((f) => `  ${f.status} ${f.url}${f.location ? ` → ${f.location}` : ""}`).join("\n");
  const subject = `🚨 SportsBookISH canary: ${failures.length} URL${failures.length > 1 ? "s" : ""} unhealthy`;
  const text = `Canary detected ${failures.length} URL${failures.length > 1 ? "s" : ""} returning unexpected status:\n\n${summary}\n\nInvestigate immediately — middleware or routing change likely. https://hyder.me/api/seo/cron-route-canary to re-run.`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SportsBookISH Canary <alerts@sportsbookish.com>",
      to: [ALERT_TO],
      subject,
      text,
    }),
  });
  return r.ok ? { ok: true } : { ok: false, error: `${r.status}` };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  const supabase = getSupabase();
  const startedAt = new Date().toISOString();

  const liveSlugs = await sampleLiveSlugs(supabase);
  const canaries = [...STATIC_CANARIES, ...liveSlugs];

  const results = await Promise.all(canaries.map(fetchHead));
  const failures = results.filter((r) => r.status !== 200);

  // Log run to DB (rolling history) — non-blocking
  await supabase.from("sb_route_health").insert({
    checked_at: startedAt,
    total: results.length,
    failures: failures.length,
    detail: failures,
  }).then(() => null, () => null);

  // Alert only if we've seen the same failure shape on the previous run
  // (avoids one-off transient 502 spam). We compare against the most
  // recent prior row.
  let alerted = false;
  if (failures.length > 0) {
    const { data: prior } = await supabase
      .from("sb_route_health")
      .select("detail")
      .order("checked_at", { ascending: false })
      .range(1, 1)  // second-most-recent
      .maybeSingle();
    const priorUrls = new Set(((prior?.detail || []).map((d) => `${d.status}|${d.url}`)));
    const repeats = failures.filter((f) => priorUrls.has(`${f.status}|${f.url}`));
    if (repeats.length > 0) {
      const sent = await sendAlert(repeats);
      alerted = sent.ok;
    }
  }

  return res.status(200).json({
    checked_at: startedAt,
    total: results.length,
    failures: failures.length,
    alerted,
    failures_detail: failures.slice(0, 20),
  });
}
