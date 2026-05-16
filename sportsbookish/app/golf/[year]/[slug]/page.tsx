import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TournamentView from "@/components/golf/TournamentView";
import ClosedTournamentView from "@/components/golf/ClosedTournamentView";
import { fetchTournamentBySlug, fetchTournamentArchive } from "@/lib/golf-data";
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
  let title: string;
  let description: string;

  if (t.status === "closed") {
    const arch = await fetchTournamentArchive(year, slug);
    const winRows = (arch.archive?.final_snapshot?.rows || [])
      .filter((r) => r.market_type === "win" && r.kalshi?.implied_prob != null)
      .sort((a, b) => (b.kalshi!.implied_prob! - a.kalshi!.implied_prob!));
    const top = winRows[0];
    const topName = top?.player?.name;
    const topPct = top?.kalshi?.implied_prob != null ? `${(top.kalshi.implied_prob * 100).toFixed(0)}%` : null;
    title = topName && topPct
      ? `${t.name} ${year} final odds — Kalshi closed ${topName} at ${topPct}`
      : `${t.name} ${year} — final Kalshi & sportsbook odds`;
    description = topName
      ? `Final Kalshi outright winner odds for the ${t.name} (${year}). Kalshi closed with ${topName} as the favorite${topPct ? ` at ${topPct}` : ""}. Includes DataGolf model and book consensus across 11+ sportsbooks.`
      : `Archived Kalshi, DataGolf, and sportsbook odds for the ${t.name} (${year}).`;
  } else {
    title = `${t.name} ${year} odds — Kalshi vs Polymarket vs sportsbooks`;
    description = `Live ${marketLabel} odds for the ${t.name} ${year}. Compare every player's Kalshi price against DraftKings, FanDuel, BetMGM and 11+ more sportsbooks plus the DataGolf model. Updated every 5 minutes.`;
  }

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

  if (t.status === "closed") {
    const { archive } = await fetchTournamentArchive(year, slug);
    return (
      <ClosedTournamentView
        tournament={t}
        year={year}
        archive={archive}
        canonicalPath={tournamentUrl(year, slug)}
      />
    );
  }

  return (
    <TournamentView
      tournamentId={t.id}
      marketType={mt}
      canonicalPath={tournamentUrl(year, slug)}
    />
  );
}
