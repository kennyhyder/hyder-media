import { notFound } from "next/navigation";
import type { Metadata } from "next";
import EventView from "@/components/sports/EventView";
import ClosedEventView from "@/components/sports/ClosedEventView";
import { fetchEventBySlug, fetchEventDetail, fetchEventArchive } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";

// Canonical sports-event route. Renders the full event detail page directly
// (no longer redirects to /event/[id] — that route now 308s here instead).
//
// When the event is status=closed, falls back to the final_snapshot from
// sports_event_archive so the URL keeps serving content for SEO long after
// the live Kalshi market has settled.

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

  const canonical = `${SITE_URL}${eventUrl(league, year, slug)}`;
  const ogImage = `${SITE_URL}/api/og/sports-event?id=${evt.id}`;

  // Closed events get a results-focused title; open events get the live title.
  if (evt.status === "closed") {
    const arch = await fetchEventArchive(league, year, slug);
    const sides = arch.archive?.final_snapshot?.markets || [];
    // Pick the side with the highest closing Kalshi as the "winner"
    const sorted = [...sides].filter((s) => s.kalshi?.implied_prob != null).sort((a, b) => (b.kalshi!.implied_prob! - a.kalshi!.implied_prob!));
    const winner = sorted[0]?.contestant_label;
    const closePct = sorted[0]?.kalshi?.implied_prob != null ? `${(sorted[0].kalshi!.implied_prob! * 100).toFixed(0)}%` : null;
    const title = winner && closePct
      ? `${evt.title} ${year} final odds — Kalshi closed ${winner} at ${closePct}`
      : `${evt.title} ${year} — final Kalshi & sportsbook odds`;
    const description = winner
      ? `Final Kalshi event-contract pricing for ${evt.title} (${year}). Kalshi closed with ${winner} as the favorite${closePct ? ` at ${closePct}` : ""}. Includes book consensus from DraftKings, FanDuel, BetMGM, and 8+ more sportsbooks.`
      : `Archived Kalshi event-contract pricing for ${evt.title} (${year}) plus closing US sportsbook consensus across DraftKings, FanDuel, BetMGM, and 8+ more books.`;
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: { title, description, url: canonical, type: "article", images: [ogImage], siteName: "SportsBookISH" },
      twitter: { card: "summary_large_image", title, description, images: [ogImage] },
    };
  }

  const detail = await fetchEventDetail(evt.id);
  const m0 = detail?.markets?.[0];
  const m1 = detail?.markets?.[1];
  const lines = [m0, m1].filter(Boolean).map((m) =>
    `${m!.contestant_label}: Kalshi ${m!.implied_prob != null ? `${(m!.implied_prob * 100).toFixed(1)}%` : "—"} vs books ${m!.books_median != null ? `${(m!.books_median * 100).toFixed(1)}%` : "—"}`
  ).join(" · ");

  const title = `${evt.title} ${year} odds — Kalshi vs Polymarket vs sportsbooks`;
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

  if (evt.status === "closed") {
    const { archive } = await fetchEventArchive(league, year, slug);
    return (
      <ClosedEventView
        event={evt}
        league={league}
        year={year}
        archive={archive}
        canonicalPath={eventUrl(league, year, slug)}
      />
    );
  }

  return (
    <EventView
      eventId={evt.id}
      league={league}
      canonicalPath={eventUrl(league, year, slug)}
    />
  );
}
