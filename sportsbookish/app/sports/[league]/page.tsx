import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { fetchLeagues, fetchLeagueData } from "@/lib/sports-data";
import { fetchMovements } from "@/lib/movements-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { fmtPctSigned } from "@/lib/format";
import GameCard from "@/components/sports/GameCard";
import SportsBookTable, { type SportsRow } from "@/components/sports/SportsBookTable";
import SportsBestBets from "@/components/sports/SportsBestBets";
import UpsellBanner from "@/components/UpsellBanner";
import { JsonLd, breadcrumbLd, itemListLd, faqLd, faqForLeaguePage } from "@/lib/seo";
import FaqSection from "@/components/FaqSection";
import { slugify, eventUrl } from "@/lib/slug";

// Returns canonical slug URL using DB-stored slug + season_year when present,
// else falls back to a computed slug, else legacy UUID URL.
function eventLinkFor(
  league: string,
  e: { id: string; title: string; start_time: string | null; slug?: string | null; season_year?: number | null }
): string {
  const slug = e.slug || slugify(e.title);
  if (!slug) return `/sports/${league}/event/${e.id}`;
  const year = e.season_year || (e.start_time ? new Date(e.start_time).getUTCFullYear() : new Date().getUTCFullYear());
  return eventUrl(league, year, slug);
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ league: string }> }): Promise<Metadata> {
  const { league } = await params;
  const leagues = await fetchLeagues();
  const meta = leagues.find((l) => l.key === league);
  if (!meta) return { title: "Sports — SportsBookISH" };
  const title = `${meta.display_name} — Kalshi vs Books | SportsBookISH`;
  const description = `Live ${meta.display_name} odds: every game compared between Kalshi and US sportsbooks. Find the best edge in seconds — free, no signup.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/sports/${league}` },
    openGraph: { title, description, url: `${SITE_URL}/sports/${league}`, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EVENT_TYPE_LABEL: Record<string, string> = {
  game: "Game",
  series: "Playoff series",
  championship: "Championship",
  conference: "Conference winner",
  division: "Division winner",
  playoffs: "Make / miss playoffs",
  record_best: "Best regular-season record",
  record_worst: "Worst regular-season record",
  win_total: "Team win totals",
  mvp: "MVP",
  award: "Awards",
  trade: "Trades & roster moves",
};

// Free tier sees only "game" type events. Pro+ sees every other event type.
const PAID_EVENT_TYPES = [
  "championship",
  "conference",
  "division",
  "series",
  "playoffs",
  "record_best",
  "record_worst",
  "win_total",
  "mvp",
  "award",
  "trade",
];

function visibleEventTypesForTier(tier: string): string[] {
  if (tier === "free") return ["game"];
  return ["game", ...PAID_EVENT_TYPES];
}

export default async function LeaguePage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const { tier, userId } = await getCurrentTier();
  const isAnonymous = !userId;

  const [leagues, leagueData, leagueMoves] = await Promise.all([
    fetchLeagues(),
    fetchLeagueData(league),
    fetchMovements({ sinceHours: 24, league, minDelta: 0.02, limit: 6 }),
  ]);
  const events = leagueData.events;
  const allBooks = leagueData.books;
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();
  const allowedTypes = visibleEventTypesForTier(tier);
  const isPaidTier = tier !== "free";

  // Group by event_type
  const groups: Record<string, typeof events> = {};
  for (const e of events) {
    if (!groups[e.event_type]) groups[e.event_type] = [];
    groups[e.event_type].push(e);
  }

  // Flatten "game" events into team-rows for the unified book table
  const gameRows: SportsRow[] = [];
  for (const e of groups.game || []) {
    for (const m of e.markets || []) {
      gameRows.push({
        event_id: e.id,
        event_title: e.title,
        start_time: e.start_time,
        market_id: m.id,
        contestant_label: m.contestant_label,
        implied_prob: m.implied_prob,
        books_count: m.books_count,
        books_median: m.books_median,
        edge_vs_books_median: m.edge_vs_books_median,
        edge_vs_best_book: m.edge_vs_best_book,
        best_book: m.best_book,
        book_prices: m.book_prices,
        polymarket_prob: m.polymarket_prob ?? null,
      });
    }
  }

  // Display order for the non-game cards section below
  const order = [
    "championship",
    "conference",
    "division",
    "series",
    "playoffs",
    "mvp",
    "award",
    "record_best",
    "record_worst",
    "win_total",
    "trade",
  ];

  // Stats for the strip at top — same shape as golf tournament page.
  const totalGames = (groups.game || []).length;
  const totalMarkets = (groups.game || []).reduce((s, e) => s + (e.markets?.length || 0), 0);
  const kalshiQuotes = gameRows.filter((r) => r.implied_prob != null).length;
  const bookQuotes = gameRows.reduce((s, r) => s + (r.books_count || 0), 0);
  const gamesWithBooks = (groups.game || []).filter((e) => (e.markets || []).some((m) => (m.books_count ?? 0) > 0)).length;
  const booksTracked = allBooks.length;

  const eventList = (groups.game || []).map((e) => ({
    name: `${e.title} — Kalshi odds`,
    url: eventLinkFor(league, e),
  }));
  // Pick the row with the largest absolute edge for the FAQ "biggest edge" answer.
  const bestEdgeRow = gameRows.reduce<SportsRow | null>((acc, r) => {
    const e = r.edge_vs_books_median;
    if (e == null) return acc;
    if (!acc || Math.abs(e) > Math.abs(acc.edge_vs_books_median ?? 0)) return r;
    return acc;
  }, null);

  const faqItems = faqForLeaguePage({
    leagueDisplayName: meta.display_name,
    totalGames,
    totalMarkets,
    booksTracked,
    bestEdgeContestant: bestEdgeRow?.contestant_label ?? null,
    bestEdgePct: bestEdgeRow?.edge_vs_books_median ?? null,
    hasFutures: order.some((t) => (groups[t] || []).length > 0),
  });

  const ldData = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Sports", url: "/sports" },
      { name: meta.display_name, url: `/sports/${league}` },
    ]),
    itemListLd(`${meta.display_name} games with Kalshi odds`, eventList),
    faqLd(faqItems),
  ];

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      {isAnonymous && <UpsellBanner variant="anonymous" next={`/sports/${league}`} />}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground">← Sports</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{meta.icon}</span>
            <span>{meta.display_name}</span>
          </div>
          {isAnonymous ? (
            <Link href={`/signup?next=/sports/${league}`} className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 font-semibold">Sign up free</Link>
          ) : (
            <div className="w-12" />
          )}
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1800px] px-4 py-8">
        {totalGames > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Games" value={String(totalGames)} />
            <Stat label="With books" value={`${gamesWithBooks}/${totalGames}`} tone={gamesWithBooks > 0 ? "ok" : undefined} />
            <Stat label="Markets" value={String(totalMarkets)} />
            <Stat label="Kalshi quotes" value={String(kalshiQuotes)} tone="kalshi" />
            <Stat label="Book quotes" value={String(bookQuotes)} />
            <Stat label="Books tracked" value={String(booksTracked)} />
          </div>
        )}

        {leagueMoves.length > 0 && (
          <section className="mb-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">📈 Recent moves (24h)</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {leagueMoves.map((m) => (
                <Link key={m.id} href={eventLinkFor(league, { id: m.event_id, title: m.event_title || "", start_time: null })} className={`block rounded border p-2 text-xs hover:bg-muted/30 ${m.direction === "up" ? "border-emerald-500/30" : "border-rose-500/30"}`}>
                  <div className="font-medium truncate">{m.contestant_label}</div>
                  <div className={`text-sm tabular-nums font-bold ${m.direction === "up" ? "text-emerald-500" : "text-rose-500"}`}>{fmtPctSigned(m.delta)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{m.event_title}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {events.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No open events for {meta.display_name} right now. Check back during the season.
          </div>
        )}

        {/* Unified book table for game-type events */}
        {(groups.game?.length ?? 0) > 0 && (
          <section className="mb-8">
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Game slate ({groups.game!.length})</h2>
            </div>
            <SportsBestBets league={league} rows={gameRows} isAnonymous={isAnonymous} />
            <SportsBookTable league={league} rows={gameRows} books={allBooks} isPaidTier={isPaidTier} />
          </section>
        )}

        {/* Non-game event types rendered as cards, grouped + tier-gated */}
        {order.map((type) => {
          const list = groups[type];
          if (!list?.length) return null;
          const locked = !allowedTypes.includes(type);
          return (
            <section key={type} className="mb-8">
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{EVENT_TYPE_LABEL[type] || type} ({list.length})</h2>
                {locked && <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15 text-[10px]"><Lock className="h-2.5 w-2.5 mr-1" />Pro</Badge>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((e) => {
                  if (locked) {
                    return (
                      <Link key={e.id} href="/pricing" className="block">
                        <Card className="opacity-50 hover:opacity-80 transition-opacity">
                          <CardContent className="p-4 relative">
                            <div className="text-sm font-semibold leading-tight blur-sm">{e.title}</div>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20"><Lock className="h-3 w-3 mr-1" />Pro</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  }
                  return <GameCard key={e.id} event={e} league={league} />;
                })}
              </div>
            </section>
          );
        })}

        {tier === "free" && (
          <div className="mt-8 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            Free tier sees individual games only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro ($10/mo)</Link> to unlock championship & conference futures, MVP & award odds, division winners, win totals, playoff series, team detail pages, and historical archives.
          </div>
        )}

        <FaqSection items={faqItems} heading={`${meta.display_name} odds — frequently asked questions`} />
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "kalshi" | "ok" }) {
  const cls = tone === "kalshi" ? "text-amber-500" : tone === "ok" ? "text-emerald-500" : "text-foreground";
  return (
    <div className="bg-card border border-border rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
