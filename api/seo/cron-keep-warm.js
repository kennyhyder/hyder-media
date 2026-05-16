import { createClient } from "@supabase/supabase-js";

// Keep-warm cron. Pings the live data-plane endpoints every minute so the
// CDN cache stays fresh and users never hit a cold-cache 6-9s wait. The
// upstream's stale-while-revalidate=120 means each ping refreshes the cache
// for the next ~2 minutes; running this every minute gives a healthy margin.
//
// Hits the most-trafficked endpoints:
//   - /api/golfodds/comparison for every market type on the active tournament
//   - /api/sports/events for each league (with markets)
//   - /api/golfodds/tournament-info for active tournament
//
// Tradeoff: ~1-2 extra function invocations per minute. Worth it for the UX.

export const config = { maxDuration: 60 };

const SITE_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";
const MARKETS = ["win", "t5", "t10", "t20", "t40", "mc", "r1lead", "r2lead", "r3lead", "r1t5", "r1t10", "r1t20", "r2t5", "r2t10", "r3t5", "r3t10"];

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function warm(url) {
  try {
    const t0 = Date.now();
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(30000) });
    return { url, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { url, error: e.message };
  }
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const t0 = Date.now();
  const urls = [];

  // Active golf tournament — warm comparison for every market type
  try {
    const { data: tournaments } = await supabase
      .from("golfodds_tournaments")
      .select("id")
      .eq("status", "upcoming")
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1);
    if (tournaments?.[0]?.id) {
      const tid = tournaments[0].id;
      urls.push(`${SITE_HOST}/api/golfodds/tournament-info?id=${tid}`);
      for (const mt of MARKETS) {
        urls.push(`${SITE_HOST}/api/golfodds/comparison?tournament_id=${tid}&market_type=${mt}`);
      }
      urls.push(`${SITE_HOST}/api/golfodds/matchups?tournament_id=${tid}`);
      urls.push(`${SITE_HOST}/api/golfodds/props?tournament_id=${tid}`);
      urls.push(`${SITE_HOST}/api/golfodds/ladder?tournament_id=${tid}`);
    }
  } catch {}

  // Per-league sports endpoints (with markets — heaviest call)
  try {
    const { data: leagues } = await supabase.from("sports_leagues").select("key");
    for (const lg of leagues || []) {
      urls.push(`${SITE_HOST}/api/sports/events?league=${lg.key}&status=open&with=markets`);
    }
  } catch {}

  // Tournaments list + leagues meta
  urls.push(`${SITE_HOST}/api/golfodds/tournaments`);
  urls.push(`${SITE_HOST}/api/sports/leagues`);

  // Sequential warming — spreads load across the minute so Supabase pooler
  // never sees 28 simultaneous queries. We have ~55 seconds before the next
  // cron tick; 28 URLs × ~1.5s warm = ~42s, leaves plenty of headroom.
  const results = [];
  for (const url of urls) {
    results.push(await warm(url));
  }

  const ok = results.filter((r) => r.status === 200).length;
  const failed = results.filter((r) => r.error || r.status !== 200);

  return res.status(200).json({
    warmed: urls.length,
    ok,
    failed: failed.length,
    failures: failed.slice(0, 5),
    elapsed_ms: Date.now() - t0,
  });
}
