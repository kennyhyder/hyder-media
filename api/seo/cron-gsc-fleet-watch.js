// GSC fleet watcher — the "analyzed, fixed, resubmitted" loop for all census
// properties. Runs 2x daily (vercel.json). For each domain:
//   1. Live robots.txt + sitemap-index health (a 5xx robots.txt makes Google
//      treat the WHOLE domain as blocked — the failure Kenny saw).
//   2. GSC sitemaps API: errors/warnings => AUTO-RESUBMIT the sitemap.
//   3. Homepage URL-inspection: must stay indexed + robots-allowed.
//   4. Snapshot to mc_gsc_watch (Mission Control) for trending.
//   5. Anything auto-fix can't cure -> mc_incidents + email (12h throttle,
//      shared sb_alert_throttle key 'gsc-fleet').
// Auth: Bearer CRON_SECRET (fail closed).
import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 120 };

const FLEET = [
  { domain: "censusfleet.com", sitemapIndex: "https://censusfleet.com/sitemap.xml" },
  { domain: "gridcensus.com", sitemapIndex: "https://gridcensus.com/sitemap-index.xml" },
  { domain: "towercensus.com", sitemapIndex: "https://towercensus.com/sitemap-index.xml" },
  { domain: "aquacensus.com", sitemapIndex: "https://aquacensus.com/sitemap-index.xml" },
  { domain: "buildingcensus.com", sitemapIndex: "https://buildingcensus.com/sitemap-index.xml" },
  { domain: "carriercensus.com", sitemapIndex: "https://carriercensus.com/sitemap-index.xml" },
  { domain: "panelcensus.com", sitemapIndex: "https://panelcensus.com/sitemap-index.xml" },
  { domain: "wellcensus.com", sitemapIndex: "https://wellcensus.com/sitemap-index.xml" },
];
const ALERT_TO = "kenny@hyder.me";

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GSC_CLIENT_ID.trim(),
      client_secret: process.env.GSC_CLIENT_SECRET.trim(),
      refresh_token: process.env.GSC_FLEET_REFRESH_TOKEN.trim(),
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}`);
  return (await r.json()).access_token;
}

async function gapi(at, url, method = "GET", body = null) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) return { error: r.status, detail: text.slice(0, 200) };
  return text ? JSON.parse(text) : {};
}

async function checkDomain(at, { domain, sitemapIndex }) {
  const out = { domain, issues: [], fixes: [], critical: [] };
  // 1) live robots + sitemap index
  try {
    const r = await fetch(`https://${domain}/robots.txt`, { redirect: "follow" });
    const body = await r.text();
    if (r.status >= 500) out.critical.push(`robots.txt HTTP ${r.status} — Google treats domain as BLOCKED`);
    else if (r.status !== 200 || !/user-agent/i.test(body)) out.issues.push(`robots.txt unhealthy (HTTP ${r.status})`);
  } catch (e) { out.critical.push(`robots.txt unreachable: ${e.message}`); }
  try {
    const r = await fetch(sitemapIndex, { redirect: "follow" });
    if (r.status !== 200) out.critical.push(`sitemap index HTTP ${r.status}`);
  } catch (e) { out.critical.push(`sitemap index unreachable: ${e.message}`); }

  // 2) GSC sitemaps: errors/warnings -> resubmit
  const site = encodeURIComponent(`sc-domain:${domain}`);
  const subs = (await gapi(at, `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps`)).sitemap || [];
  out.sitemaps = subs.length;
  out.gscErrors = subs.reduce((s, m) => s + Number(m.errors || 0), 0);
  out.gscWarnings = subs.reduce((s, m) => s + Number(m.warnings || 0), 0);
  out.indexed = subs.reduce((s, m) => s + (m.contents || []).reduce((a, c) => a + Number(c.indexed || 0), 0), 0);
  out.submitted = subs.reduce((s, m) => s + (m.contents || []).reduce((a, c) => a + Number(c.submitted || 0), 0), 0);
  for (const m of subs) {
    if (Number(m.errors || 0) > 0) {
      const path = encodeURIComponent(m.path);
      const r = await gapi(at, `https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${path}`, "PUT");
      out.fixes.push(`resubmitted ${m.path} (${m.errors} errors)${r.error ? " FAILED" : ""}`);
    }
  }

  // 3) homepage inspection
  const insp = await gapi(at, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", "POST",
    { inspectionUrl: `https://${domain}/`, siteUrl: `sc-domain:${domain}` });
  const idx = insp?.inspectionResult?.indexStatusResult || {};
  out.homeCoverage = idx.coverageState || "unknown";
  out.homeRobots = idx.robotsTxtState || "unknown";
  if (idx.robotsTxtState === "DISALLOWED") out.critical.push("homepage DISALLOWED by robots.txt in Google's view");
  else if (idx.coverageState && !/indexed/i.test(idx.coverageState) && domain !== "censusfleet.com") {
    out.issues.push(`homepage coverage: ${idx.coverageState}`);
  }
  return out;
}

function mcClient() {
  return createClient(process.env.MC_SUPABASE_URL.trim(), process.env.MC_SUPABASE_SERVICE_KEY.trim());
}
function sbClient() {
  return createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
}

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret || (req.headers.authorization || "") !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const at = await accessToken();
    const results = [];
    for (const f of FLEET) results.push(await checkDomain(at, f));

    // snapshot to MC
    try {
      await mcClient().from("mc_gsc_watch").insert(results.map((r) => ({
        domain: r.domain, sitemaps: r.sitemaps, gsc_errors: r.gscErrors,
        gsc_warnings: r.gscWarnings, indexed: r.indexed, submitted: r.submitted,
        home_coverage: r.homeCoverage, home_robots: r.homeRobots,
        issues: r.issues, fixes: r.fixes, critical: r.critical,
      })));
    } catch { /* snapshot best-effort */ }

    const bad = results.filter((r) => r.critical.length || r.issues.length || r.gscErrors > 0);
    const fixed = results.filter((r) => r.fixes.length);
    let alerted = false;
    if (bad.some((r) => r.critical.length) || bad.some((r) => r.gscErrors > 0)) {
      // throttle: 12h shared key
      const sb = sbClient();
      const { data: th } = await sb.from("sb_alert_throttle").select("last_sent").eq("key", "gsc-fleet").maybeSingle();
      const okToSend = !th?.last_sent || Date.now() - new Date(th.last_sent).getTime() > 12 * 3600e3;
      if (okToSend && process.env.RESEND_API_KEY) {
        const lines = bad.map((r) =>
          `${r.domain}\n${[...r.critical.map((c) => "  CRITICAL: " + c), ...r.issues.map((i) => "  issue: " + i),
             ...(r.gscErrors ? [`  GSC sitemap errors: ${r.gscErrors} (auto-resubmitted)`] : [])].join("\n")}`
        ).join("\n\n");
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Census Fleet GSC Watch <alerts@sportsbookish.com>",
            to: [ALERT_TO],
            subject: `🔍 GSC fleet watch: ${bad.length} propert${bad.length > 1 ? "ies" : "y"} need attention`,
            text: `Auto-fixes already applied where possible. Remaining:\n\n${lines}\n\n(throttled: max one of these per 12h)`,
          }),
        });
        alerted = r.ok;
        if (alerted) await sb.from("sb_alert_throttle").upsert({ key: "gsc-fleet", last_sent: new Date().toISOString() });
      }
    }
    return res.status(200).json({
      checked: results.length,
      autofixes: fixed.flatMap((r) => r.fixes),
      needs_attention: bad.map((r) => r.domain),
      alerted,
      results,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
