import { notFound } from "next/navigation";
import type { Metadata } from "next";
import EventView from "@/components/sports/EventView";
import { fetchEventBySlug, fetchEventDetail } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";

// Canonical sports-event route. Renders the full event detail page directly
// (no longer redirects to /event/[id] — that route now 308s here instead).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: {
  params: Promise<{ league: string; year: string; slug: string }>;
}): Promise<Metadata> {
  const { league, year: yearStr, slug } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year)) return { title: "Event" };

  const evt = await fetchEventBySlug(league, year, slug);
  if (!evt) return { title: "Event not found" };

  // Try to enrich the meta description with actual line data
  const detail = await fetchEventDetail(evt.id);
  const m0 = detail?.markets?.[0];
  const m1 = detail?.markets?.[1];
  const lines = [m0, m1].filter(Boolean).map((m) =>
    `${m!.contestant_label}: Kalshi ${m!.implied_prob != null ? `${(m!.implied_prob * 100).toFixed(1)}%` : "—"} vs books ${m!.books_median != null ? `${(m!.books_median * 100).toFixed(1)}%` : "—"}`
  ).join(" · ");

  const canonical = `${SITE_URL}${eventUrl(league, year, slug)}`;
  const ogImage = `${SITE_URL}/api/og/sports-event?id=${evt.id}`;
  // Layout template appends " | SportsBookISH" automatically
  const title = `${evt.title} ${year} odds — Kalshi vs sportsbooks`;
  const description = lines || `Live ${evt.title} odds — Kalshi event-contract prices vs DraftKings, FanDuel, BetMGM and 8+ sportsbooks. Updated every 5 minutes.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website", images: [ogImage], siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
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

  return (
    <EventView
      eventId={evt.id}
      league={league}
      canonicalPath={eventUrl(league, year, slug)}
    />
  );
}
