import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TournamentView from "@/components/golf/TournamentView";
import { fetchTournamentBySlug } from "@/lib/golf-data";
import { tournamentUrl } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params, searchParams }: {
  params: Promise<{ year: string; slug: string }>;
  searchParams: Promise<{ mt?: string }>;
}): Promise<Metadata> {
  const { year: yearStr, slug } = await params;
  const { mt = "win" } = await searchParams;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year)) return { title: "Tournament — SportsBookISH" };

  const t = await fetchTournamentBySlug(year, slug);
  if (!t) return { title: "Tournament not found — SportsBookISH" };

  const url = tournamentUrl(year, slug);
  const marketLabel = mt === "win" ? "outright winner" : mt;
  // Layout template appends " | SportsBookISH" automatically — don't duplicate
  const title = `${t.name} ${year} odds — Kalshi vs Polymarket vs sportsbooks`;
  const description = `Live ${marketLabel} odds for the ${t.name} ${year}. Compare every player's Kalshi price against DraftKings, FanDuel, BetMGM and 11+ more sportsbooks plus the DataGolf model. Updated every 5 minutes.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}${url}` },
    openGraph: { title, description, url: `${SITE_URL}${url}`, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GolfTournamentBySlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; slug: string }>;
  searchParams: Promise<{ mt?: string }>;
}) {
  const { year: yearStr, slug } = await params;
  const { mt = "win" } = await searchParams;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year)) notFound();

  const t = await fetchTournamentBySlug(year, slug);
  if (!t) notFound();

  return (
    <TournamentView
      tournamentId={t.id}
      marketType={mt}
      canonicalPath={tournamentUrl(year, slug)}
    />
  );
}
