import { redirect } from "next/navigation";
import type { Metadata } from "next";
import EventView from "@/components/sports/EventView";
import { fetchEventDetail, fetchEventSlugById } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";

// Legacy UUID route — preserved so old links keep working, redirects to the
// canonical /sports/[league]/[year]/[slug]. Uses 307 (temporary) instead of
// 308 (permanent) because permanentRedirect responses get aggressively
// cached by browsers and Vercel's edge, and we sometimes rewrite slugs
// (e.g. after fixing a collision via backfill). A cached 308 to a now-stale
// slug 404s on the client until the cache TTL expires. 307 keeps the
// redirect dynamic so slug changes propagate immediately.
// (SEO trade-off: 308 passes more equity than 307. Acceptable given the
// canonical link in <head> still points at the slug URL, so crawlers index
// the canonical regardless of redirect status code.)

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string; id: string }> }): Promise<Metadata> {
  const { league, id } = await params;
  const slugRow = await fetchEventSlugById(id);
  if (slugRow) {
    // Canonical points at slug URL — search engines indexing the UUID will
    // recognize the slug as authoritative.
    return {
      alternates: { canonical: `${SITE_URL}${eventUrl(league, slugRow.season_year, slugRow.slug)}` },
    };
  }
  const detail = await fetchEventDetail(id);
  if (!detail) return { title: "Event not found" };
  const title = `${detail.event.title} — Kalshi vs Polymarket vs Books`;
  return { title, alternates: { canonical: `${SITE_URL}/sports/${league}/event/${id}` } };
}

export default async function LegacyEventPage({ params }: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await params;

  const slugRow = await fetchEventSlugById(id);
  if (slugRow) {
    redirect(eventUrl(slugRow.league, slugRow.season_year, slugRow.slug));
  }

  // Slug not yet backfilled — render inline. Canonical URL points at the
  // UUID route since that's what we're serving.
  return (
    <EventView
      eventId={id}
      league={league}
      canonicalPath={`/sports/${league}/event/${id}`}
    />
  );
}
