import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchGolferBySlug } from "@/lib/golf-data";
import { tournamentUrl, golfPlayerUrl } from "@/lib/slug";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, MARKET_LABELS } from "@/lib/format";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await fetchGolferBySlug(slug);
  if (!p) return { title: "Player not found" };
  const canonical = `${SITE_URL}${golfPlayerUrl(slug)}`;
  const rankPart = p.player.owgr_rank ? ` (OWGR #${p.player.owgr_rank})` : "";
  // Layout template appends " | SportsBookISH"
  const title = `${p.player.name}${rankPart} odds — Kalshi vs sportsbooks`;
  const description = `Live ${p.player.name} odds across every PGA Tour market on Kalshi — win, top 5/10/20, make cut, first-round leader, head-to-head matchups. Compared against DraftKings, FanDuel, BetMGM and 11+ sportsbooks plus the DataGolf model baseline.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "profile", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GolferPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await fetchGolferBySlug(slug);
  if (!p) notFound();

  const totalMarkets = p.tournaments.reduce((s, t) => s + t.markets.length, 0);
  const hasOwgr = p.player.owgr_rank != null;

  // Find biggest edge across all markets for FAQ
  const bestEdge = p.tournaments.flatMap((t) => t.markets.map((m) => ({ t, m })))
    .reduce<{ event: string; market: string; edge: number } | null>((acc, { t, m }) => {
      const k = m.kalshi?.implied_prob;
      const b = m.books?.median;
      if (k == null || b == null) return acc;
      const edge = b - k;
      if (!acc || Math.abs(edge) > Math.abs(acc.edge)) return { event: t.tournament.name, market: MARKET_LABELS[m.market_type] || m.market_type, edge };
      return acc;
    }, null);

  const ldData: object[] = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Golf", url: "/golf" },
      { name: p.player.name, url: golfPlayerUrl(slug) },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: p.player.name,
      url: `${SITE_URL}${golfPlayerUrl(slug)}`,
      jobTitle: "Professional Golfer",
      ...(p.player.country ? { nationality: p.player.country } : {}),
      ...(p.player.owgr_rank ? { description: `OWGR World Ranking #${p.player.owgr_rank}` } : {}),
    },
  ];

  const faqItems = [
    {
      question: `What ${p.player.name} betting markets are live right now?`,
      answer: `Kalshi currently lists ${totalMarkets} ${p.player.name} markets across ${p.tournaments.length} ${p.tournaments.length === 1 ? "tournament" : "tournaments"} — outright winner, top 5/10/20, make cut, first-round leader, and head-to-head matchups depending on the event. SportsBookISH compares each against the DataGolf model baseline plus 11+ sportsbooks.`,
    },
    ...(bestEdge ? [{
      question: `Where's the best ${p.player.name} betting edge right now?`,
      answer: `The ${bestEdge.market} market on ${bestEdge.event} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the books median. Edges shift continuously; refresh for the latest snapshot.`,
    }] : []),
    ...(hasOwgr ? [{
      question: `What is ${p.player.name}'s world golf ranking?`,
      answer: `${p.player.name} is currently ranked #${p.player.owgr_rank} in the Official World Golf Ranking (OWGR). Rankings update weekly; SportsBookISH refreshes this data from DataGolf at every cron tick.`,
    }] : []),
    {
      question: `How does the DataGolf model compare to Kalshi for ${p.player.name}?`,
      answer: `DataGolf publishes a baseline win/top-N probability based on its proprietary strokes-gained model. When Kalshi prices ${p.player.name} cheaper than that baseline (positive edge), the model suggests Kalshi is mispriced low and the contract is a buy. When Kalshi prices higher, the model considers it expensive.`,
    },
    {
      question: `Are there ${p.player.name} head-to-head matchup bets on Kalshi?`,
      answer: `Yes — Kalshi lists tournament-long and round-by-round head-to-head matchups for many tour pros. SportsBookISH tracks each matchup separately under its parent tournament page; matchup edges are often more pronounced than outright win-market edges because matchup books vary more widely between sportsbooks.`,
    },
  ];
  ldData.push(faqLd(faqItems));

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground/80">← Golf</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>⛳</span>
            <span>{p.player.name}</span>
            {p.player.owgr_rank && <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">OWGR #{p.player.owgr_rank}</Badge>}
          </div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{p.player.name} odds</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>Live Kalshi prices vs sportsbook consensus + DataGolf model.</span>
            <span className="text-foreground/70">{totalMarkets} markets across {p.tournaments.length} {p.tournaments.length === 1 ? "tournament" : "tournaments"}</span>
            {p.player.country && <Badge variant="outline" className="border-border/60 text-xs">{p.player.country}</Badge>}
          </div>
        </div>

        {p.tournaments.length === 0 && (
          <div className="text-center text-muted-foreground py-16">
            No open markets for {p.player.name} right now. Check back during the next tournament week.
          </div>
        )}

        {p.tournaments.map(({ tournament, markets }) => {
          const tHref = tournament.slug && tournament.season_year
            ? tournamentUrl(tournament.season_year, tournament.slug)
            : `/golf/tournament?id=${tournament.id}`;
          return (
            <section key={tournament.id} className="mb-8">
              <div className="flex items-baseline gap-2 mb-3">
                <Link href={tHref} className="text-base font-semibold hover:underline">
                  {tournament.name}
                </Link>
                {tournament.is_major && <Badge className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/20 text-[10px]">Major</Badge>}
                {tournament.start_date && <span className="text-xs text-muted-foreground">{tournament.start_date}</span>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {markets.map((m) => {
                  const edge = (m.kalshi?.implied_prob != null && m.books?.median != null)
                    ? m.books.median - m.kalshi.implied_prob : null;
                  return (
                    <Card key={m.market_id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold">{MARKET_LABELS[m.market_type] || m.market_type}</CardTitle>
                      </CardHeader>
                      <CardContent className="pb-4 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Kalshi</span>
                          <span className="tabular-nums text-amber-500 font-semibold">{fmtPct(m.kalshi?.implied_prob)}</span>
                        </div>
                        {m.dg?.dg_prob != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">DataGolf</span>
                            <span className="tabular-nums text-sky-500">{fmtPct(m.dg.dg_prob)}</span>
                          </div>
                        )}
                        {m.books?.median != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Books median ({m.books.count})</span>
                            <span className="tabular-nums">{fmtPct(m.books.median)}</span>
                          </div>
                        )}
                        {m.books?.best && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Best book</span>
                            <span className="tabular-nums">{bookLabel(m.books.best.book)} {fmtAmerican(m.books.best.american)}</span>
                          </div>
                        )}
                        {edge != null && (
                          <div className="flex items-center justify-between pt-1 border-t border-border/40">
                            <span className="text-muted-foreground">Edge vs median</span>
                            <span className={`tabular-nums font-semibold ${edge > 0 ? "text-emerald-500" : edge < 0 ? "text-rose-500" : ""}`}>{fmtPctSigned(edge)}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}

        <FaqSection items={faqItems} heading={`${p.player.name} betting — FAQ`} />
      </main>
    </div>
  );
}
