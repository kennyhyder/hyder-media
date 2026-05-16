import type { MetadataRoute } from "next";
import { fetchLeagues, fetchEventsByLeague, fetchArchivedEventsByLeague, fetchTeams } from "@/lib/sports-data";
import { fetchTournaments, fetchArchivedTournaments, fetchGolfers } from "@/lib/golf-data";
import { eventUrl, tournamentUrl, teamUrl, playerUrl, golfPlayerUrl, slugify } from "@/lib/slug";
import { GLOSSARY } from "@/lib/glossary";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Single-file sitemap at /sitemap.xml. ~1,200 URLs — well under the 50k/50MB
// limits. changeFrequency + priority tuned per URL type:
//
//   hourly  → live game events, league hubs, golf tournaments
//   daily   → contestant hubs, team/player indexes
//   weekly  → compare-book pages, data export
//   monthly → glossary, learn articles, tool calculators, authority pages
//
// New URLs from cron-ingest auto-appear here within 30s (no revalidate cap).
// Search Console submission: paste https://sportsbookish.com/sitemap.xml once,
// Google polls it hourly automatically.

type Sm = MetadataRoute.Sitemap;

export default async function sitemap(): Promise<Sm> {
  const now = new Date();
  const urls: Sm = [];

  // ---- Static / marketing / authority ----
  urls.push(
    { url: `${SITE_URL}/`,                lastModified: now, changeFrequency: "hourly",  priority: 1.0 },
    { url: `${SITE_URL}/pricing`,         lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${SITE_URL}/sports`,          lastModified: now, changeFrequency: "hourly",  priority: 0.9 },
    { url: `${SITE_URL}/sports/movers`,   lastModified: now, changeFrequency: "hourly",  priority: 0.7 },
    { url: `${SITE_URL}/golf`,            lastModified: now, changeFrequency: "hourly",  priority: 0.9 },
    { url: `${SITE_URL}/golf/players`,    lastModified: now, changeFrequency: "daily",   priority: 0.7 },
    { url: `${SITE_URL}/compare`,         lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${SITE_URL}/signup`,          lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/login`,           lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  );

  // ---- Learn + glossary ----
  urls.push(
    { url: `${SITE_URL}/learn`,                              lastModified: now, changeFrequency: "weekly",  priority: 0.75 },
    { url: `${SITE_URL}/learn/what-are-kalshi-odds`,         lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/learn/no-vig-explained`,             lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-edge-betting`,          lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-vs-prediction-markets`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/learn/glossary`,                     lastModified: now, changeFrequency: "monthly", priority: 0.75 },
  );
  for (const e of GLOSSARY) {
    urls.push({ url: `${SITE_URL}/learn/glossary/${e.slug}`, lastModified: now, changeFrequency: "monthly", priority: 0.6 });
  }

  // ---- Tools ----
  urls.push(
    { url: `${SITE_URL}/tools`,                       lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/no-vig-calculator`,     lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/kelly-calculator`,      lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/odds-converter`,        lastModified: now, changeFrequency: "monthly", priority: 0.75 },
    { url: `${SITE_URL}/tools/parlay-calculator`,     lastModified: now, changeFrequency: "monthly", priority: 0.75 },
  );

  // ---- Compare books ----
  for (const book of ["polymarket", "draftkings", "fanduel", "betmgm", "caesars", "betrivers", "fanatics"]) {
    // Polymarket comparison gets higher priority — high Google Trends search volume
    const pri = book === "polymarket" ? 0.85 : 0.7;
    urls.push({ url: `${SITE_URL}/compare/kalshi-vs-${book}`, lastModified: now, changeFrequency: "weekly", priority: pri });
  }

  // ---- Authority / data ----
  urls.push(
    { url: `${SITE_URL}/data`,              lastModified: now, changeFrequency: "weekly",  priority: 0.75 },
    { url: `${SITE_URL}/data/huggingface`,  lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/api/docs`,          lastModified: now, changeFrequency: "weekly",  priority: 0.85 },
    { url: `${SITE_URL}/press`,             lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/about/methodology`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/about/kenny-hyder`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/contact`,           lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  );

  // ---- Dynamic data: leagues, events, contestants, golfers, tournaments ----
  try {
    const [leagues, contestants, golfers, tournaments] = await Promise.all([
      fetchLeagues(),
      fetchTeams(),
      fetchGolfers(),
      fetchTournaments(),
    ]);

    // Per-league hub + team/player index pages
    for (const l of leagues) {
      urls.push(
        { url: `${SITE_URL}/sports/${l.key}`,         lastModified: now, changeFrequency: "hourly", priority: 0.85 },
        { url: `${SITE_URL}/sports/${l.key}/teams`,   lastModified: now, changeFrequency: "daily",  priority: 0.65 },
        { url: `${SITE_URL}/sports/${l.key}/players`, lastModified: now, changeFrequency: "daily",  priority: 0.65 },
      );
    }

    // Individual sports events — open (live + upcoming) + closed (archive)
    const yearsSeen = new Map<string, Set<number>>(); // league -> Set<year> for year-index URLs
    for (const l of leagues) {
      const seenIds = new Set<string>();
      yearsSeen.set(l.key, new Set());
      const [openEvents, closedEvents] = await Promise.all([
        fetchEventsByLeague(l.key).catch(() => []),
        fetchArchivedEventsByLeague(l.key).catch(() => []),
      ]);
      for (const e of [...openEvents, ...closedEvents]) {
        if (seenIds.has(e.id)) continue;
        seenIds.add(e.id);
        const year = e.season_year || (e.start_time ? new Date(e.start_time).getUTCFullYear() : now.getUTCFullYear());
        yearsSeen.get(l.key)!.add(year);
        const slug = e.slug || slugify(e.title);
        if (!slug) continue;
        const startTime = e.start_time ? new Date(e.start_time) : null;
        const isClosed = e.status === "closed";
        const upcoming = !isClosed && (!startTime || startTime > now);
        urls.push({
          url: `${SITE_URL}${eventUrl(l.key, year, slug)}`,
          lastModified: now,
          changeFrequency: upcoming ? "hourly" : (isClosed ? "yearly" : "weekly"),
          priority: upcoming ? 0.7 : (isClosed ? 0.45 : 0.4),
        });
      }
    }

    // Year-index pages per (league, year)
    for (const [leagueKey, years] of yearsSeen.entries()) {
      for (const year of years) {
        urls.push({
          url: `${SITE_URL}/sports/${leagueKey}/${year}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }

    // Golf tournaments — open + archived
    const archivedTournaments = await fetchArchivedTournaments().catch(() => []);
    const golfYearsSeen = new Set<number>();
    const seenT = new Set<string>();
    for (const t of [...tournaments, ...archivedTournaments]) {
      if (seenT.has(t.id)) continue;
      seenT.add(t.id);
      const year = t.season_year || (t.start_date ? new Date(t.start_date).getUTCFullYear() : now.getUTCFullYear());
      golfYearsSeen.add(year);
      const slug = t.slug || slugify(t.name);
      const url = slug ? `${SITE_URL}${tournamentUrl(year, slug)}` : `${SITE_URL}/golf/tournament?id=${t.id}`;
      const start = t.start_date ? new Date(t.start_date) : null;
      const isClosed = t.status === "closed";
      const upcoming = !isClosed && (!start || start > now);
      urls.push({
        url,
        lastModified: now,
        changeFrequency: upcoming ? "hourly" : (isClosed ? "yearly" : "monthly"),
        priority: upcoming ? 0.8 : (isClosed ? 0.55 : 0.5),
      });
    }
    for (const year of golfYearsSeen) {
      urls.push({
        url: `${SITE_URL}/golf/${year}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    // Contestants (teams + players)
    for (const c of contestants) {
      urls.push({
        url: `${SITE_URL}${c.kind === "player" ? playerUrl(c.league, c.slug) : teamUrl(c.league, c.slug)}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.6,
      });
    }

    // Golfers (PGA Tour roster)
    for (const g of golfers) {
      urls.push({
        url: `${SITE_URL}${golfPlayerUrl(g.slug)}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: g.owgr_rank && g.owgr_rank <= 100 ? 0.7 : 0.55,
      });
    }
  } catch {
    // If the data plane stutters mid-sitemap, return what we have so the
    // sitemap still renders (better partial than 500).
  }

  return urls;
}
