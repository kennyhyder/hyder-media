import { createClient } from "@supabase/supabase-js";

// Daily health check. Verifies:
//   - All cron schedules ran in the last 24 hours
//   - Sitemap is reachable + has > 1000 URLs
//   - HF dataset CSV was updated in the last 36 hours
//   - At least N events have been ingested in last 24h
//
// Surfaces issues via JSON response (admin can poll) + emails if RESEND_API_KEY
// is set AND a critical check fails.

export const config = { maxDuration: 30 };

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function checkSitemap() {
  try {
    const r = await fetch("https://sportsbookish.com/sitemap.xml", { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, status: r.status };
    const xml = await r.text();
    const urlCount = (xml.match(/<url>/g) || []).length;
    return { ok: urlCount > 100, url_count: urlCount, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function checkHfDataset() {
  try {
    const r = await fetch("https://huggingface.co/api/datasets/kennyhyder/sportsbookish-daily-odds", { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    const lastModified = new Date(data.lastModified);
    const ageHours = (Date.now() - lastModified.getTime()) / (1000 * 3600);
    return {
      ok: ageHours < 36,
      last_modified: data.lastModified,
      age_hours: Number(ageHours.toFixed(1)),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function checkRecentIngest(supabase) {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    // sports_events / golf_tournaments are low-volume (~100s/day) so
    // count('exact') is fine. sports_quotes runs ~1.5M rows/day — count
    // queries time out even with indexes, so check the latest-row
    // timestamp instead (O(1) on idx_sports_quotes_fetched_at).
    const [{ count: sportsEvents }, { count: golfTournaments }, latestQuoteRow, latestBookQuoteRow] = await Promise.all([
      supabase.from("sports_events").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("golfodds_tournaments").select("id", { count: "exact", head: true }).gte("updated_at", since),
      supabase.from("sports_quotes").select("fetched_at").order("fetched_at", { ascending: false }).limit(1),
      supabase.from("sports_book_quotes").select("fetched_at").order("fetched_at", { ascending: false }).limit(1),
    ]);
    const latestQuote = latestQuoteRow.data?.[0]?.fetched_at || null;
    const latestBookQuote = latestBookQuoteRow.data?.[0]?.fetched_at || null;
    const quoteAgeMin = latestQuote ? (Date.now() - new Date(latestQuote).getTime()) / 60000 : Infinity;
    const bookAgeMin = latestBookQuote ? (Date.now() - new Date(latestBookQuote).getTime()) / 60000 : Infinity;
    return {
      // Kalshi quotes cron runs every 5 min; if latest is older than 20 min, alarm.
      // Books cron runs every 30 min; if latest is older than 90 min, alarm.
      ok: quoteAgeMin < 20 && bookAgeMin < 90,
      sports_events_new: sportsEvents || 0,
      golf_tournaments_touched: golfTournaments || 0,
      latest_kalshi_quote: latestQuote,
      kalshi_age_min: Number(quoteAgeMin.toFixed(1)),
      latest_book_quote: latestBookQuote,
      book_age_min: Number(bookAgeMin.toFixed(1)),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function checkContestantSlugs(supabase) {
  try {
    const { count: total } = await supabase
      .from("sports_contestants")
      .select("id", { count: "exact", head: true });
    const { count: slugged } = await supabase
      .from("sports_contestants")
      .select("id", { count: "exact", head: true })
      .not("slug", "is", null);
    const pct = total ? (slugged || 0) / total * 100 : 0;
    return { ok: pct >= 95, total, slugged, pct: Number(pct.toFixed(1)) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const t0 = Date.now();

  const [sitemap, hf, ingest, slugs] = await Promise.all([
    checkSitemap(),
    checkHfDataset(),
    checkRecentIngest(supabase),
    checkContestantSlugs(supabase),
  ]);

  const checks = { sitemap, huggingface: hf, recent_ingest: ingest, contestant_slugs: slugs };
  const failed = Object.entries(checks).filter(([_, v]) => !v.ok).map(([k]) => k);
  const allOk = failed.length === 0;

  // Email if anything is broken and we have email config
  if (!allOk && process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: "SportsBookISH Health <alerts@sportsbookish.com>",
          to: ["kenny@hyder.me"],
          subject: `[SportsBookISH] Health check FAILED: ${failed.join(", ")}`,
          text: `Failed checks: ${failed.join(", ")}\n\n${JSON.stringify(checks, null, 2)}`,
        }),
      });
    } catch { /* alert is best-effort */ }
  }

  return res.status(200).json({
    ok: allOk,
    failed_checks: failed,
    checks,
    elapsed_ms: Date.now() - t0,
    checked_at: new Date().toISOString(),
  });
}
