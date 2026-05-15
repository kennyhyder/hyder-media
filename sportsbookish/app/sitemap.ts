import type { MetadataRoute } from "next";
import { fetchLeagues, fetchEventsByLeague } from "@/lib/sports-data";
import { fetchTournaments } from "@/lib/golf-data";
import { eventUrl, tournamentUrl, slugify } from "@/lib/slug";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Dynamic sitemap — refreshed on every request. Lists every public page
// (landing, pricing, login, signup, sports hub, league pages, game event
// pages, golf hub, tournament pages) so Google can crawl deep into the
// odds data. Auth-gated pages (/dashboard, /admin, /alerts, /settings)
// are omitted by design.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticUrls: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/sports`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/sports/movers`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/golf`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/compare`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/learn`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    // High-intent comparison pages
    { url: `${SITE_URL}/compare/kalshi-vs-draftkings`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-fanduel`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-betmgm`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/compare/kalshi-vs-caesars`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/compare/kalshi-vs-betrivers`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/compare/kalshi-vs-fanatics`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    // Learn / educational
    { url: `${SITE_URL}/learn/what-are-kalshi-odds`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/learn/no-vig-explained`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-edge-betting`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/learn/kalshi-vs-prediction-markets`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  try {
    const [leagues, tournaments] = await Promise.all([fetchLeagues(), fetchTournaments()]);

    // League pages
    const leagueUrls: MetadataRoute.Sitemap = leagues.map((l) => ({
      url: `${SITE_URL}/sports/${l.key}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    }));

    // Tournament pages — prefer the slug URL when available, fall back to the
    // legacy ?id= URL for any tournament that hasn't been slugged yet (newly
    // ingested before the cron's slug-write has run).
    const tournamentUrls: MetadataRoute.Sitemap = tournaments.map((t) => {
      const year = t.start_date ? new Date(t.start_date).getUTCFullYear() : new Date().getUTCFullYear();
      const slug = slugify(t.short_name || t.name);
      const url = slug ? `${SITE_URL}${tournamentUrl(year, slug)}` : `${SITE_URL}/golf/tournament?id=${t.id}`;
      return {
        url,
        lastModified: now,
        changeFrequency: "hourly" as const,
        priority: 0.7,
      };
    });

    // Per-event sports URLs — fetch each league's open events. Slug URL takes
    // precedence; UUID URL is only emitted when slug isn't yet backfilled.
    const eventUrls: MetadataRoute.Sitemap = [];
    for (const l of leagues) {
      try {
        const events = await fetchEventsByLeague(l.key);
        for (const e of events) {
          const year = e.start_time ? new Date(e.start_time).getUTCFullYear() : new Date().getUTCFullYear();
          const slug = slugify(e.title);
          const url = slug ? `${SITE_URL}${eventUrl(l.key, year, slug)}` : `${SITE_URL}/sports/${l.key}/event/${e.id}`;
          eventUrls.push({
            url,
            lastModified: now,
            changeFrequency: "hourly",
            priority: 0.6,
          });
        }
      } catch {
        // skip on error so the sitemap stays live even if data plane stutters
      }
    }

    return [...staticUrls, ...leagueUrls, ...tournamentUrls, ...eventUrls];
  } catch {
    return staticUrls;
  }
}
