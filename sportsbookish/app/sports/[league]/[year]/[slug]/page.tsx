import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { fetchEventBySlug } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";

// SEO-friendly slug route for a single sports event.
//
// Today's behavior: resolve slug → id, then 308 to the existing /event/[id]
// canonical render. The slug URL is the one we publish in nav, sitemap, share
// links — Google will index this URL and follow the redirect to the rendered
// content. (When EventView is extracted in Phase 2b this becomes the direct
// render and the /event/[id] route flips to a 308 in the other direction.)

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: {
  params: Promise<{ league: string; year: string; slug: string }>;
}): Promise<Metadata> {
  const { league, year: yearStr, slug } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year)) return { title: "Event — SportsBookISH" };

  const evt = await fetchEventBySlug(league, year, slug);
  if (!evt) return { title: "Event not found — SportsBookISH" };

  const canonical = `${SITE_URL}${eventUrl(league, year, slug)}`;
  // Layout template appends " | SportsBookISH" automatically — don't duplicate
  const title = `${evt.title} ${year} odds — Kalshi vs sportsbooks`;
  const description = `Live ${evt.title} odds comparison — Kalshi event-contract pricing vs DraftKings, FanDuel, BetMGM and 8+ more sportsbooks. Updated every 5 minutes.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function SportsEventBySlug({ params }: {
  params: Promise<{ league: string; year: string; slug: string }>;
}) {
  const { league, year: yearStr, slug } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year)) notFound();

  const evt = await fetchEventBySlug(league, year, slug);
  if (!evt) notFound();

  // Until EventView is extracted (Phase 2b) we redirect to the UUID renderer.
  // permanentRedirect returns a 308 so search engines treat the slug URL as
  // the canonical entry point and the UUID URL as the fulfillment target.
  permanentRedirect(`/sports/${league}/event/${evt.id}`);
}
