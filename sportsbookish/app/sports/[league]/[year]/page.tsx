import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fetchLeagues, fetchEventsByLeague, fetchArchivedEventsByLeague } from "@/lib/sports-data";
import { JsonLd, breadcrumbLd, itemListLd } from "@/lib/seo";
import { Card, CardContent } from "@/components/ui/card";
import { eventUrl } from "@/lib/slug";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string; year: string }> }): Promise<Metadata> {
  const { league, year } = await params;
  const leagues = await fetchLeagues();
  const meta = leagues.find((l) => l.key === league);
  if (!meta) return { title: "Sports — SportsBookISH" };
  const title = `${meta.display_name} ${year} archive — Kalshi vs Polymarket vs sportsbook odds`;
  const description = `Every ${meta.display_name} event from ${year} with Kalshi event-contract odds, Polymarket prices, and US sportsbook consensus. Browse closed events with final pricing.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/sports/${league}/${year}` },
    openGraph: { title, description, url: `${SITE_URL}/sports/${league}/${year}`, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LeagueYearIndexPage({ params }: { params: Promise<{ league: string; year: string }> }) {
  const { league, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);
  if (!Number.isFinite(year) || year < 2024 || year > 2099) notFound();

  const [leagues, openEvents, closedEvents] = await Promise.all([
    fetchLeagues(),
    fetchEventsByLeague(league),
    fetchArchivedEventsByLeague(league, year),
  ]);
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();

  // Merge open + closed; dedupe by id; filter to this year
  const seen = new Set<string>();
  const events = [...closedEvents, ...openEvents].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    if (e.season_year != null) return e.season_year === year;
    if (e.start_time) return new Date(e.start_time).getUTCFullYear() === year;
    return false;
  });

  // Group by event_type for cleaner browsing
  const groups: Record<string, typeof events> = {};
  for (const e of events) {
    if (!groups[e.event_type]) groups[e.event_type] = [];
    groups[e.event_type].push(e);
  }

  const itemList = events.map((e) => {
    const slug = e.slug || "event";
    return { name: e.title, url: eventUrl(league, year, slug) };
  });

  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Sports", url: "/sports" },
          { name: meta.display_name, url: `/sports/${league}` },
          { name: String(year), url: `/sports/${league}/${year}` },
        ]),
        itemListLd(`${meta.display_name} ${year} events`, itemList),
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground">← {meta.display_name}</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{meta.icon}</span>
            <span>{meta.display_name} · {year}</span>
          </div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">
          {meta.display_name} {year} archive
        </h1>
        <p className="text-muted-foreground mb-8 max-w-3xl">
          {events.length} {events.length === 1 ? "event" : "events"} in {year}. Live events show current Kalshi + book pricing; closed events show final pricing at settlement.
        </p>

        {events.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No {meta.display_name} events recorded for {year} yet.
              </p>
              <Link href={`/sports/${league}`} className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
                ← See current {meta.display_name} events
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groups).map(([type, list]) => (
              <section key={type}>
                <h2 className="text-xl font-semibold mb-3 capitalize">{type.replaceAll("_", " ")} ({list.length})</h2>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {list
                    .sort((a, b) => (b.start_time || "").localeCompare(a.start_time || ""))
                    .map((e) => {
                      const slug = e.slug || "event";
                      const href = eventUrl(league, year, slug);
                      const dateStr = e.start_time ? new Date(e.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
                      const isClosed = e.status === "closed";
                      return (
                        <li key={e.id}>
                          <Link
                            href={href}
                            className={`block rounded border px-3 py-2 transition-colors ${isClosed ? "border-border/40 bg-card/20 hover:border-muted-foreground/40" : "border-border/60 bg-card/40 hover:border-emerald-500/40"}`}
                            aria-label={isClosed ? `${e.title} — final result` : `${e.title} — live odds`}
                          >
                            <div className="flex items-center gap-2 font-medium text-sm">
                              <span>{e.title}</span>
                              {isClosed && <span className="text-[10px] uppercase tracking-wider rounded bg-muted-foreground/15 text-muted-foreground px-1.5 py-0.5" aria-hidden="true">Final</span>}
                            </div>
                            {dateStr && <div className="text-xs text-muted-foreground mt-0.5">{dateStr}{isClosed ? " · settled" : ` · ${e.status}`}</div>}
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
