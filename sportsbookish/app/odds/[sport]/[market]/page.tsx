import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct, fmtAmerican, bookLabel } from "@/lib/format";
import { eventUrl, slugify } from "@/lib/slug";
import { fetchLeagueData, type InlineMarket } from "@/lib/sports-data";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Long-tail SEO target: pages like /odds/mlb/moneyline, /odds/nba/spread,
// /odds/nfl/total, /odds/pga/winner. ~50 URLs from existing data.
const SPORTS: Record<string, { display: string; markets: string[] }> = {
  nba: { display: "NBA", markets: ["moneyline", "spread", "total"] },
  mlb: { display: "MLB", markets: ["moneyline", "spread", "total"] },
  nfl: { display: "NFL", markets: ["moneyline", "spread", "total", "championship"] },
  nhl: { display: "NHL", markets: ["moneyline", "spread", "total"] },
  ncaaf: { display: "College Football", markets: ["moneyline", "spread", "total"] },
  epl: { display: "Premier League", markets: ["moneyline"] },
  ucl: { display: "UEFA Champions League", markets: ["moneyline"] },
  mls: { display: "MLS", markets: ["moneyline"] },
  wc: { display: "World Cup", markets: ["moneyline", "championship"] },
  pga: { display: "PGA Tour", markets: ["winner"] },
};

const MARKET_DISPLAY: Record<string, string> = {
  moneyline: "Moneyline",
  spread: "Spread",
  total: "Total (Over/Under)",
  championship: "Championship Futures",
  winner: "Outright Winner",
};

interface PageProps { params: Promise<{ sport: string; market: string }> }

export async function generateStaticParams() {
  const out: Array<{ sport: string; market: string }> = [];
  for (const [sport, info] of Object.entries(SPORTS)) {
    for (const m of info.markets) out.push({ sport, market: m });
  }
  return out;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sport, market } = await params;
  const s = SPORTS[sport.toLowerCase()];
  const m = MARKET_DISPLAY[market.toLowerCase()];
  if (!s || !m) return { title: "Odds — SportsBookISH" };
  const title = `${s.display} ${m} Odds Today — Live Sportsbook Comparison | SportsBookISH`;
  const description = `Live ${s.display} ${m.toLowerCase()} odds comparison across DraftKings, FanDuel, BetMGM, Caesars and 8+ regulated US sportsbooks. Kalshi event-contract pricing overlaid. Updated continuously.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/odds/${sport}/${market}` },
    openGraph: { title, description, url: `${SITE_URL}/odds/${sport}/${market}`, siteName: "SportsBookISH", type: "website" },
  };
}

export default async function OddsPivotPage({ params }: PageProps) {
  const { sport, market } = await params;
  const sportInfo = SPORTS[sport.toLowerCase()];
  const marketDisplay = MARKET_DISPLAY[market.toLowerCase()];
  if (!sportInfo || !marketDisplay) notFound();
  const renderTime = new Date().toISOString();

  const { events, books } = await fetchLeagueData(sport);

  // For now we only deeply support moneyline (h2h) in the league feed.
  // Spread/total/championship pages render the event index + nudge users
  // to per-event pages where the full ladder lives.
  const ranked = events
    .map((e) => {
      const markets = (e.markets || []).filter(Boolean);
      const top = markets[0] as InlineMarket | undefined;
      return { event: e, top, marketCount: markets.length };
    })
    .filter((r) => r.event && (r.top != null || r.marketCount > 0))
    .slice(0, 100);

  const FAQ = [
    {
      question: `Which sportsbook has the best ${sportInfo.display} ${marketDisplay.toLowerCase()} odds?`,
      answer: `No single book consistently leads on every ${sportInfo.display} ${marketDisplay.toLowerCase()} market — best price varies game-by-game. SportsBookISH compares DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, and Circa side-by-side on every market so you can pick per bet rather than committing to one book.`,
    },
    {
      question: `How is Kalshi's ${sportInfo.display} pricing different from sportsbooks?`,
      answer: `Kalshi is a CFTC-regulated event-contracts exchange — sports outcomes trade as YES/NO contracts between users at market-set prices, not against the house at vigged odds. On ${sportInfo.display} ${marketDisplay.toLowerCase()} markets, Kalshi mid-prices typically diverge from book consensus by 2-8 percentage points; the gap is where +EV opportunities live.`,
    },
    {
      question: `How often do these odds update?`,
      answer: `Kalshi every 5 minutes. Sportsbook quotes every 15-30 minutes. Polymarket every 15 minutes. The page rerenders on every visit so the table is never older than your last page load.`,
    },
  ];

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sports", url: `${SITE_URL}/sports` },
        { name: sportInfo.display, url: `${SITE_URL}/sports/${sport}` },
        { name: `${marketDisplay} Odds`, url: `${SITE_URL}/odds/${sport}/${market}` },
      ])} />
      <JsonLd data={faqLd(FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: `${sportInfo.display} ${marketDisplay} odds — live`,
        description: `Live ${sportInfo.display} ${marketDisplay.toLowerCase()} odds across regulated US sportsbooks + Kalshi + Polymarket.`,
        pageUrl: `${SITE_URL}/odds/${sport}/${market}`,
        dateModified: renderTime,
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4 gap-2">
          <Link href={`/sports/${sport}`} className="text-sm text-muted-foreground hover:text-foreground shrink-0">← {sportInfo.display}</Link>
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
            {sportInfo.display} {marketDisplay}
          </div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">{sportInfo.display} {marketDisplay} Odds Today</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Every {sportInfo.display} {marketDisplay.toLowerCase()} market across the {books.length} regulated US sportsbooks we track, plus Kalshi event-contract pricing for comparison. Updated continuously.
          </p>
        </section>

        {/* Related market pivots */}
        <section className="flex flex-wrap gap-2 text-xs">
          {sportInfo.markets.filter((m) => m !== market.toLowerCase()).map((m) => (
            <Link key={m} href={`/odds/${sport}/${m}`} className="px-3 py-1.5 rounded border border-border/60 hover:bg-muted/50">
              {sportInfo.display} {MARKET_DISPLAY[m]} →
            </Link>
          ))}
        </section>

        {/* Live odds table */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm font-normal text-muted-foreground">
              <span>{ranked.length} markets · sorted by start time</span>
              <span>Edge vs Kalshi shown per market</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {ranked.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No active {sportInfo.display} {marketDisplay.toLowerCase()} markets right now. Check back during in-season weeks.
              </div>
            ) : (
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right text-amber-500">Kalshi</TableHead>
                    <TableHead className="text-right">Books fair</TableHead>
                    <TableHead className="text-right">Edge</TableHead>
                    <TableHead>Best book</TableHead>
                    <TableHead className="text-right">Start</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/40">
                  {ranked.map((r) => {
                    const ev = r.event;
                    const top = r.top;
                    const year = ev.season_year || (ev.start_time ? new Date(ev.start_time).getUTCFullYear() : new Date().getUTCFullYear());
                    const slug = ev.slug || slugify(ev.title);
                    const href = slug ? eventUrl(sport, year, slug) : `/sports/${sport}/event/${ev.id}`;
                    const edge = top?.edge_vs_books_median;
                    return (
                      <TableRow key={ev.id}>
                        <TableCell className="font-medium">
                          <Link href={href} className="hover:text-emerald-400 hover:underline">{ev.title}</Link>
                          {top && <div className="text-[10px] text-muted-foreground/80">{top.contestant_label}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-400">{fmtPct(top?.implied_prob ?? null, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(top?.books_median ?? null, 1)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${edge != null && edge > 0 ? "text-emerald-400" : edge != null && edge < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                          {edge != null ? `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {top?.best_book ? (
                            <span>{bookLabel(top.best_book.book)} <span className="text-muted-foreground">{fmtAmerican(top.best_book.american)}</span></span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground/80 whitespace-nowrap text-right">
                          {ev.start_time ? new Date(ev.start_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={href} className="text-xs text-emerald-400 hover:underline whitespace-nowrap">Full →</Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Cross-sport pivots */}
        <section>
          <h2 className="text-xl font-bold mb-3">Other sports — same market</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {Object.entries(SPORTS).filter(([s, info]) => s !== sport && info.markets.includes(market.toLowerCase())).map(([s, info]) => (
              <Link key={s} href={`/odds/${s}/${market}`} className="block p-2 rounded border border-border/60 hover:bg-muted/50">
                {info.display} {marketDisplay} →
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {FAQ.map((f, i) => (
                <div key={i} className="p-4">
                  <div className="font-semibold mb-1">{f.question}</div>
                  <div className="text-sm text-muted-foreground">{f.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
