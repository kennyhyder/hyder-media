import { createClient } from "@supabase/supabase-js";

// Weekly IndexNow sweep. Pings Bing/Yandex/Naver/Seznam with EVERY canonical
// URL on sportsbookish.com (capped at 10k per call). Ensures non-Google
// engines stay in sync even if the per-cron-tick pings miss anything.
//
// Cron schedule: weekly, off-peak Sunday 03:00 UTC.
// Triggered via Vercel cron with Bearer CRON_SECRET.

export const config = { maxDuration: 60 };

const INDEXNOW_KEY = "620c7d50b41090ac7f0493e654f3219c";
const SITE_HOST = "sportsbookish.com";

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAuth(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

const STATIC_URLS = [
  "/", "/pricing", "/sports", "/golf", "/golf/players", "/tools",
  "/tools/no-vig-calculator", "/tools/kelly-calculator", "/tools/odds-converter", "/tools/parlay-calculator",
  "/learn", "/learn/glossary", "/learn/what-are-kalshi-odds", "/learn/no-vig-explained",
  "/learn/kalshi-edge-betting", "/learn/kalshi-vs-prediction-markets",
  "/data", "/data/huggingface", "/press", "/about/methodology", "/about/kenny-hyder", "/contact",
  "/compare", "/compare/kalshi-vs-draftkings", "/compare/kalshi-vs-fanduel",
  "/compare/kalshi-vs-betmgm", "/compare/kalshi-vs-caesars",
  "/compare/kalshi-vs-betrivers", "/compare/kalshi-vs-fanatics",
];

const GLOSSARY_SLUGS = [
  "vig", "no-vig", "implied-probability", "expected-value", "edge",
  "moneyline", "spread", "total", "futures", "parlay", "prop-bet",
  "closing-line-value", "kelly-criterion", "kalshi-fees", "arbitrage",
  "hedge", "sharp-vs-square", "fade", "bankroll-management", "push",
];

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const supabase = getSupabase();
  const urls = new Set();

  // Static + tools + learn + compare + glossary
  for (const u of STATIC_URLS) urls.add(`https://${SITE_HOST}${u}`);
  for (const s of GLOSSARY_SLUGS) urls.add(`https://${SITE_HOST}/learn/glossary/${s}`);

  // Per-league hub + index pages
  const { data: leagues } = await supabase.from("sports_leagues").select("key");
  for (const lg of leagues || []) {
    urls.add(`https://${SITE_HOST}/sports/${lg.key}`);
    urls.add(`https://${SITE_HOST}/sports/${lg.key}/teams`);
    urls.add(`https://${SITE_HOST}/sports/${lg.key}/players`);
  }

  // Open sports events with slugs
  const { data: events } = await supabase
    .from("sports_events")
    .select("league, slug, season_year")
    .eq("status", "open")
    .not("slug", "is", null);
  for (const e of events || []) {
    if (!e.season_year) continue;
    urls.add(`https://${SITE_HOST}/sports/${e.league}/${e.season_year}/${e.slug}`);
  }

  // Golf tournaments
  const { data: tournaments } = await supabase
    .from("golfodds_tournaments")
    .select("slug, season_year, status")
    .not("slug", "is", null);
  for (const t of tournaments || []) {
    if (!t.season_year) continue;
    urls.add(`https://${SITE_HOST}/golf/${t.season_year}/${t.slug}`);
  }

  // Contestants (teams + players)
  const { data: contestants } = await supabase
    .from("sports_contestants")
    .select("league, slug, kind")
    .not("slug", "is", null);
  for (const c of contestants || []) {
    const path = c.kind === "player" ? "players" : "teams";
    urls.add(`https://${SITE_HOST}/sports/${c.league}/${path}/${c.slug}`);
  }

  // Golfers
  const { data: golfers } = await supabase
    .from("golfodds_players")
    .select("slug")
    .not("slug", "is", null);
  for (const g of golfers || []) {
    urls.add(`https://${SITE_HOST}/golf/players/${g.slug}`);
  }

  // Submit in batches of 10k (IndexNow max)
  const urlArr = Array.from(urls);
  const batches = [];
  for (let i = 0; i < urlArr.length; i += 10000) batches.push(urlArr.slice(i, i + 10000));

  const results = [];
  for (const batch of batches) {
    try {
      const r = await fetch("https://api.indexnow.org/IndexNow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: SITE_HOST,
          key: INDEXNOW_KEY,
          keyLocation: `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`,
          urlList: batch,
        }),
      });
      results.push({ submitted: batch.length, status: r.status, ok: r.ok });
    } catch (e) {
      results.push({ submitted: 0, error: e.message });
    }
  }

  return res.status(200).json({
    ok: true,
    total_urls: urlArr.length,
    batches: results,
    finished_at: new Date().toISOString(),
  });
}
