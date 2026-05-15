import type { MetadataRoute } from "next";
import { fetchLeagues, fetchEventsByLeague, fetchTeams } from "@/lib/sports-data";
import { fetchTournaments, fetchGolfers } from "@/lib/golf-data";
import { eventUrl, tournamentUrl, teamUrl, playerUrl, golfPlayerUrl, slugify } from "@/lib/slug";
import { GLOSSARY } from "@/lib/glossary";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Sharded sitemap. Next.js auto-generates an index at /sitemap.xml linking to
// /sitemap/{id}.xml for each shard returned by generateSitemaps. This gives
// Search Console per-type indexation reporting AND keeps individual sitemap
// files small enough to crawl efficiently (each shard < 5MB / 50K URLs).
//
// Shards by content type so we can tune changeFrequency + priority per type:
//   0 → static / marketing / authority
//   1 → sports events (game lines, futures, awards)
//   2 → golf tournaments
//   3 → team + player contestant hubs (across all sports)
//   4 → golfer hubs (PGA Tour roster)
//   5 → learn articles + glossary terms
//   6 → tools + compare + data + contact
//
// Routes adjusted via app config — Next.js handles the sitemap index XML.

type Sm = MetadataRoute.Sitemap;
const ITEMS_PER_SHARD = 10000;  // safety cap; we're nowhere near it

export async function generateSitemaps() {
  // Return one descriptor per shard. id values match the switch in sitemap()
  return [
    { id: 0 }, // static
    { id: 1 }, // sports events
    { id: 2 }, // golf tournaments
    { id: 3 }, // contestants (teams + players)
    { id: 4 }, // golfers
    { id: 5 }, // learn + glossary
    { id: 6 }, // tools + meta
  ];
}

export default async function sitemap({ id }: { id: number }): Promise<Sm> {
  const now = new Date();
  switch (id) {
    case 0: return staticUrls(now);
    case 1: return await sportsEvents(now);
    case 2: return await golfTournaments(now);
    case 3: return await contestants(now);
    case 4: return await golfers(now);
    case 5: return learnAndGlossary(now);
    case 6: return toolsAndMeta(now);
    default: return [];
  }
}

function staticUrls(now: Date): Sm {
  return [
    // Top-level marketing
    { url: `${SITE_URL}/`,          lastModified: now, changeFrequency: "hourly",  priority: 1.0 },
    { url: `${SITE_URL}/pricing`,   lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${SITE_URL}/sports`,    lastModified: now, changeFrequency: "hourly",  priority: 0.9 },
    { url: `${SITE_URL}/sports/movers`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/golf`,      lastModified: now, changeFrequency: "hourly",  priority: 0.9 },
    { url: `${SITE_URL}/golf/players`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/compare`,   lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    // Auth surface (low priority but useful for SC coverage)
    { url: `${SITE_URL}/signup`,    lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/login`,     lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}

async function sportsEvents(now: Date): Promise<Sm> {
  try {
    const leagues = await fetchLeagues();
    const out: Sm = [];

    // Per-league hub + team/player index pages
    for (const l of leagues) {
      out.push(
        { url: `${SITE_URL}/sports/${l.key}`,         lastModified: now, changeFrequency: "hourly", priority: 0.85 },
        { url: `${SITE_URL}/sports/${l.key}/teams`,   lastModified: now, changeFrequency: "daily",  priority: 0.65 },
        { url: `${SITE_URL}/sports/${l.key}/players`, lastModified: now, changeFrequency: "daily",  priority: 0.65 },
      );
    }

    // Individual events
    for (const l of leagues) {
      let events;
      try { events = await fetchEventsByLeague(l.key); } catch { continue; }
      for (const e of events) {
        const year = e.season_year || (e.start_time ? new Date(e.start_time).getUTCFullYear() : now.getUTCFullYear());
        const slug = e.slug || slugify(e.title);
        if (!slug) continue;
        const startTime = e.start_time ? new Date(e.start_time) : null;
        // Tighter frequency for events that haven't started; weekly for past
        const upcoming = !startTime || startTime > now;
        out.push({
          url: `${SITE_URL}${eventUrl(l.key, year, slug)}`,
          lastModified: now,
          changeFrequency: upcoming ? "hourly" : "weekly",
          priority: upcoming ? 0.7 : 0.4,
        });
      }
    }
    return out.slice(0, ITEMS_PER_SHARD);
  } catch { return []; }
}

async function golfTournaments(now: Date): Promise<Sm> {
  try {
    const tournaments = await fetchTournaments();
    return tournaments.map((t) => {
      const year = t.season_year || (t.start_date ? new Date(t.start_date).getUTCFullYear() : now.getUTCFullYear());
      const slug = t.slug || slugify(t.name);
      const url = slug ? `${SITE_URL}${tournamentUrl(year, slug)}` : `${SITE_URL}/golf/tournament?id=${t.id}`;
      const start = t.start_date ? new Date(t.start_date) : null;
      const upcoming = !start || start > now;
      return {
        url,
        lastModified: now,
        changeFrequency: upcoming ? ("hourly" as const) : ("monthly" as const),
        priority: upcoming ? 0.8 : 0.5,
      };
    }).slice(0, ITEMS_PER_SHARD);
  } catch { return []; }
}

async function contestants(now: Date): Promise<Sm> {
  try {
    const list = await fetchTeams();
    return list.map((c) => ({
      url: `${SITE_URL}${c.kind === "player" ? playerUrl(c.league, c.slug) : teamUrl(c.league, c.slug)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })).slice(0, ITEMS_PER_SHARD);
  } catch { return []; }
}

async function golfers(now: Date): Promise<Sm> {
  try {
    const list = await fetchGolfers();
    return list.map((g) => ({
      url: `${SITE_URL}${golfPlayerUrl(g.slug)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: g.owgr_rank && g.owgr_rank <= 100 ? 0.7 : 0.55,
    })).slice(0, ITEMS_PER_SHARD);
  } catch { return []; }
}

function learnAndGlossary(now: Date): Sm {
  return [
    { url: `${SITE_URL}/learn`, lastModified: now, changeFrequency: "weekly", priority: 0.75 },
    { url: `${SITE_URL}/learn/what-are-kalshi-odds`,        lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/learn/no-vig-explained`,            lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-edge-betting`,         lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-vs-prediction-markets`,lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/learn/glossary`,                    lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    ...GLOSSARY.map((e) => ({
      url: `${SITE_URL}/learn/glossary/${e.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}

function toolsAndMeta(now: Date): Sm {
  return [
    { url: `${SITE_URL}/tools`,                       lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/no-vig-calculator`,     lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/kelly-calculator`,      lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/odds-converter`,        lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/parlay-calculator`,     lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    // Compare book pages
    { url: `${SITE_URL}/compare/kalshi-vs-draftkings`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-fanduel`,    lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-betmgm`,     lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-caesars`,    lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    { url: `${SITE_URL}/compare/kalshi-vs-betrivers`,  lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    { url: `${SITE_URL}/compare/kalshi-vs-fanatics`,   lastModified: now, changeFrequency: "weekly", priority: 0.65 },
    // Authority / data
    { url: `${SITE_URL}/data`,                  lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${SITE_URL}/about/methodology`,     lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/about/kenny-hyder`,     lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`,               lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
