import { permanentRedirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import ContestantView from "@/components/sports/ContestantView";
import { fetchTeamBySlug, fetchLeagues } from "@/lib/sports-data";
import { teamUrl, playerUrl } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: {
  params: Promise<{ league: string; slug: string }>;
}): Promise<Metadata> {
  const { league, slug } = await params;
  const [t, leagues] = await Promise.all([fetchTeamBySlug(league, slug), fetchLeagues()]);
  if (!t) return { title: "Team not found" };
  const leagueName = leagues.find((l) => l.key === league)?.display_name || league.toUpperCase();
  const canonical = `${SITE_URL}${teamUrl(league, slug)}`;
  const title = `${t.team.name} odds — ${leagueName} Kalshi vs Polymarket vs sportsbooks`;
  const description = `Live Kalshi odds for ${t.team.name} across every market — ${t.counts.games} ${t.counts.games === 1 ? "game" : "games"} and ${t.counts.futures} futures. Compare against DraftKings, FanDuel, BetMGM and 8+ books.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TeamPage({ params }: {
  params: Promise<{ league: string; slug: string }>;
}) {
  const { league, slug } = await params;
  const t = await fetchTeamBySlug(league, slug);
  if (!t) notFound();

  // If this contestant is actually a player (MVP candidate, etc.), redirect
  // to the player route. /teams/ stays canonical for actual teams.
  if (t.team.kind === "player") {
    permanentRedirect(playerUrl(league, slug));
  }

  return <ContestantView league={league} slug={slug} expectedKind="team" canonicalPath={teamUrl(league, slug)} />;
}
