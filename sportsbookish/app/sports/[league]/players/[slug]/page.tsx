import { permanentRedirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import ContestantView from "@/components/sports/ContestantView";
import { fetchTeamBySlug, fetchLeagues } from "@/lib/sports-data";
import { teamUrl, playerUrl } from "@/lib/slug";

// Sports player hub — for individual contestants (MVP candidates, award
// nominees, etc.) in /sports/{league}/players/{slug}. Mirrors the team route
// but with Person schema instead of SportsTeam. If a contestant is actually
// a team (e.g. someone hit this URL by mistake), 308 to the team route.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: {
  params: Promise<{ league: string; slug: string }>;
}): Promise<Metadata> {
  const { league, slug } = await params;
  const [t, leagues] = await Promise.all([fetchTeamBySlug(league, slug), fetchLeagues()]);
  if (!t) return { title: "Player not found" };
  const leagueName = leagues.find((l) => l.key === league)?.display_name || league.toUpperCase();
  const canonical = `${SITE_URL}${playerUrl(league, slug)}`;
  const title = `${t.team.name} odds — ${leagueName} Kalshi vs Polymarket vs sportsbooks`;
  const description = `Live ${t.team.name} odds across every Kalshi market — MVP, awards, season win totals, championship futures. Compared against DraftKings, FanDuel, BetMGM and 8+ sportsbooks.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "profile", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SportsPlayerPage({ params }: {
  params: Promise<{ league: string; slug: string }>;
}) {
  const { league, slug } = await params;
  const t = await fetchTeamBySlug(league, slug);
  if (!t) notFound();

  if (t.team.kind === "team") {
    permanentRedirect(teamUrl(league, slug));
  }

  return <ContestantView league={league} slug={slug} expectedKind="player" canonicalPath={playerUrl(league, slug)} />;
}
