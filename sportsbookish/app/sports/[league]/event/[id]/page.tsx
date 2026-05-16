import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import EventView from "@/components/sports/EventView";
import { fetchEventDetail, fetchEventSlugById } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";

// Legacy UUID route — preserved so old links keep working, but 308-redirects
// to the canonical /sports/[league]/[year]/[slug] URL when the slug is known.
// Falls back to inline render only when the slug isn't backfilled yet (which
// shouldn't happen post-deploy but is defended against).

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
    permanentRedirect(eventUrl(slugRow.league, slugRow.season_year, slugRow.slug));
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
