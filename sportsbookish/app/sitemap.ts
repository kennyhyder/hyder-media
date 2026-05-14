import type { MetadataRoute } from "next";
import { fetchLeagues, fetchEventsByLeague } from "@/lib/sports-data";
import { fetchTournaments } from "@/lib/golf-data";

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

    // Tournament pages
    const tournamentUrls: MetadataRoute.Sitemap = tournaments.map((t) => ({
      url: `${SITE_URL}/golf/tournament?id=${t.id}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    }));

    // Per-event sports URLs — fetch each league's open events
    const eventUrls: MetadataRoute.Sitemap = [];
    for (const l of leagues) {
      try {
        const events = await fetchEventsByLeague(l.key);
        for (const e of events) {
          eventUrls.push({
            url: `${SITE_URL}/sports/${l.key}/event/${e.id}`,
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
