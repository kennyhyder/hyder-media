import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchLeagues, fetchLeagueData, type InlineMarket, type SportsEvent } from "@/lib/sports-data";
import { fmtPct, fmtAmerican, bookLabel } from "@/lib/format";
import { eventUrl, slugify } from "@/lib/slug";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { trackIfUser } from "@/lib/track-event";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Live Arbitrage Bets — Risk-Free Sportsbook + Kalshi Arbs | SportsBookISH";
const DESC = "Every two-way market where sportsbook odds + Kalshi/Polymarket create a guaranteed profit window. Updated continuously across MLB, NBA, NFL, NHL, college, soccer, and golf.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/sports/arbitrage` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/sports/arbitrage`, siteName: "SportsBookISH", type: "website" },
};

interface ArbRow {
  league: string;
  league_display: string;
  event: SportsEvent;
  market: InlineMarket;
  yes_side: { source: "kalshi" | "books" | "polymarket"; pct: number; american?: number | null; book_label?: string };
  no_side: { source: "kalshi" | "books" | "polymarket"; pct: number; american?: number | null; book_label?: string };
  profit_pct: number;   // (1 - (yes_pct + no_pct)) / (yes_pct + no_pct)
  stake_split: { yes_stake_pct: number; no_stake_pct: number };
  total_implied: number;
}

const LEAGUE_DISPLAY: Record<string, string> = {
  nba: "NBA", mlb: "MLB", nhl: "NHL", nfl: "NFL", ncaaf: "NCAAF",
  epl: "EPL", mls: "MLS", ucl: "UCL", wc: "WC", pga: "PGA",
};

const HUB_FAQ = [
  {
    question: "What is sports arbitrage?",
    answer: "An arbitrage opportunity exists when the implied probabilities of opposing outcomes on the same market sum to less than 100%. If YES is offered at 48% on Kalshi and NO is offered at 49% on DraftKings (combined 97%), a properly sized position on both produces a guaranteed ~3% profit regardless of which side wins.",
  },
  {
    question: "How do I execute an arb?",
    answer: "Size each side in proportion to the inverse of its probability so both sides pay the same amount. For a 97% combined arb on a $1,000 total bankroll: $1000 × (49% ÷ 97%) ≈ $505 buying YES on Kalshi and $1000 × (48% ÷ 97%) ≈ $495 on NO at DraftKings. Both legs return ~$1,030 — guaranteed ~$30 profit.",
  },
  {
    question: "Are sportsbook + Kalshi arbs sustainable?",
    answer: "Yes. Kalshi is a regulated event-contracts exchange — they don't limit accounts for winning users the way sportsbooks do. Crossing a sportsbook against Kalshi is the safest arb path because the exchange leg is bulletproof.",
  },
  {
    question: "How fresh is this data?",
    answer: "Kalshi quotes refresh every 5 minutes. Sportsbook quotes every 15-30 minutes. Polymarket every 15 minutes. Arbitrages close fast — what's visible here is what was true at page render time; verify both legs in their respective platforms before sizing positions.",
  },
];

function americanFromProb(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
}

export default async function ArbitragePage() {
  const { userId } = await getCurrentTier();
  void trackIfUser(userId, "positive_ev_view", { props: { surface: "arbitrage" } });
  const leagues = await fetchLeagues();
  const renderTime = new Date().toISOString();

  const leagueData = await Promise.all(
    leagues.map((l) => fetchLeagueData(l.key).then((d) => ({ league: l.key, ...d })))
  );

  // Build YES/NO pairs per (event, contestant_label). For two-way markets
  // (h2h, championship YES/NO), Kalshi gives us YES; books give us no-vig
  // YES per contestant. To form an arb we need YES on one and 1-YES on
  // another contestant of the same market (the "other side"). For now we
  // surface: (a) Kalshi YES vs books' best NO (1 - books_min YES of the
  // OPPOSITE contestant), and (b) Polymarket vs books.
  const arbs: ArbRow[] = [];

  for (const ld of leagueData) {
    for (const ev of ld.events) {
      const markets = ev.markets || [];
      // For 2-contestant events, pair markets
      if (markets.length < 2) continue;
      // Build a quick lookup: contestant → market
      // We treat ANY pair of contestants where Kalshi YES + opposite Kalshi YES
      // sums to less than 1 as an arb candidate (it's already in our data,
      // and devigging is on the books side).
      for (let i = 0; i < markets.length; i++) {
        const a = markets[i];
        if (a.implied_prob == null) continue;
        // The complement: best book NO on the SAME contestant = 1 - cheapest
        // YES that a book offers on this contestant.
        const yesBestBookPct = a.books_min;
        if (yesBestBookPct == null) continue;
        // Kalshi YES is `a.implied_prob`. To form an arb: bet YES at the
        // cheaper side and NO at the cheaper side. NO at a sportsbook on
        // contestant A = (1 - best book YES on A). So total exposure =
        // kalshi_yes + (1 - books_min_yes) = kalshi_yes + (1 - books_min).
        // Arb when total < 1.
        const noBookPct = 1 - yesBestBookPct;
        const total = a.implied_prob + noBookPct;
        if (total >= 0.99) continue; // require ≥1% raw arb pre-fee
        // Construct row
        const profitPct = (1 - total) / total;
        if (profitPct < 0.01) continue;
        arbs.push({
          league: ld.league,
          league_display: LEAGUE_DISPLAY[ld.league] || ld.league.toUpperCase(),
          event: ev,
          market: a,
          yes_side: { source: "kalshi", pct: a.implied_prob, american: americanFromProb(a.implied_prob) },
          no_side: {
            source: "books",
            pct: noBookPct,
            american: americanFromProb(noBookPct),
            book_label: a.best_book?.book,
          },
          profit_pct: profitPct,
          stake_split: {
            yes_stake_pct: a.implied_prob / total,
            no_stake_pct: noBookPct / total,
          },
          total_implied: total,
        });

        // Polymarket arb: Polymarket YES vs Kalshi NO (1 - Kalshi YES)
        if (a.polymarket_prob != null) {
          const polyYes = a.polymarket_prob;
          const kalshiNo = 1 - a.implied_prob;
          const polyTotal = polyYes + kalshiNo;
          const polyProfit = (1 - polyTotal) / polyTotal;
          if (polyTotal < 0.99 && polyProfit >= 0.01) {
            arbs.push({
              league: ld.league,
              league_display: LEAGUE_DISPLAY[ld.league] || ld.league.toUpperCase(),
              event: ev,
              market: a,
              yes_side: { source: "kalshi", pct: a.implied_prob, american: americanFromProb(a.implied_prob) },
              no_side: { source: "polymarket", pct: polyYes, american: americanFromProb(polyYes) },
              profit_pct: polyProfit,
              stake_split: { yes_stake_pct: kalshiNo / polyTotal, no_stake_pct: polyYes / polyTotal },
              total_implied: polyTotal,
            });
          }
        }
      }
    }
  }

  // Sort by profit_pct DESC, top 100
  arbs.sort((a, b) => b.profit_pct - a.profit_pct);
  const top = arbs.slice(0, 100);
  const totalProfitable = top.length;

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sports", url: `${SITE_URL}/sports` },
        { name: "Arbitrage", url: `${SITE_URL}/sports/arbitrage` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: "Live sports arbitrage opportunities",
        description: DESC,
        pageUrl: `${SITE_URL}/sports/arbitrage`,
        dateModified: renderTime,
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4 gap-2">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground shrink-0">← Sports</Link>
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
            Arbitrage Scanner · {top.length} opportunities
          </div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Live Sports Arbitrage</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Two-way markets where combined implied probability of opposing outcomes is under 100%.
            Stake both sides in proportion → guaranteed profit regardless of result. Cross-platform arbs (Kalshi/Polymarket vs sportsbook) are surfaced first because exchange accounts don&apos;t get limited the way sportsbook accounts do.
          </p>
        </section>

        {top.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p>No active arbitrage opportunities right now.</p>
              <p className="text-xs mt-2">Arbs are most common 30-60 min pre-tip when Kalshi and books diverge. Check back during peak game-day hours.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Opportunities</div><div className="text-2xl font-bold tabular-nums">{totalProfitable}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Avg profit</div><div className="text-2xl font-bold tabular-nums text-emerald-400">{fmtPct(top.reduce((s, r) => s + r.profit_pct, 0) / top.length, 2)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Biggest profit</div><div className="text-2xl font-bold tabular-nums text-emerald-400">{fmtPct(top[0].profit_pct, 2)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Avg combined %</div><div className="text-2xl font-bold tabular-nums">{fmtPct(top.reduce((s, r) => s + r.total_implied, 0) / top.length, 1)}</div></CardContent></Card>
            </section>

            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  Top {top.length} arbs, ranked by profit %. Stake split shown for a $1,000 total bankroll.
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Market</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead>YES leg</TableHead>
                      <TableHead>NO leg</TableHead>
                      <TableHead className="text-right">Stake $1k</TableHead>
                      <TableHead>League</TableHead>
                      <TableHead>Start</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/40">
                    {top.map((r, idx) => {
                      const year = r.event.season_year || (r.event.start_time ? new Date(r.event.start_time).getUTCFullYear() : new Date().getUTCFullYear());
                      const slug = r.event.slug || slugify(r.event.title);
                      const href = slug ? eventUrl(r.league, year, slug) : `/sports/${r.league}/event/${r.event.id}`;
                      return (
                        <TableRow key={`${r.event.id}|${r.market.id}|${idx}`}>
                          <TableCell className="font-medium">
                            <Link href={href} className="hover:text-emerald-400 hover:underline">{r.market.contestant_label}</Link>
                            <div className="text-[10px] text-muted-foreground/80 truncate max-w-[260px]">{r.event.title}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400 font-bold">+{(r.profit_pct * 100).toFixed(2)}%</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-amber-400 border-amber-500/40">{r.yes_side.source === "kalshi" ? "Kalshi" : r.yes_side.source === "polymarket" ? "Polymarket" : "Book"}</Badge>
                            <span className="ml-2 tabular-nums">{fmtPct(r.yes_side.pct, 1)} <span className="text-muted-foreground/80">{fmtAmerican(r.yes_side.american ?? null)}</span></span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline">{r.no_side.source === "books" ? (r.no_side.book_label ? bookLabel(r.no_side.book_label) : "Book") : r.no_side.source === "polymarket" ? "Polymarket" : "Kalshi"}</Badge>
                            <span className="ml-2 tabular-nums">{fmtPct(r.no_side.pct, 1)} <span className="text-muted-foreground/80">{fmtAmerican(r.no_side.american ?? null)}</span></span>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            <div>YES ${Math.round(r.stake_split.yes_stake_pct * 1000)}</div>
                            <div className="text-muted-foreground">NO ${Math.round(r.stake_split.no_stake_pct * 1000)}</div>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{r.league_display}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {r.event.start_time ? new Date(r.event.start_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {HUB_FAQ.map((f, i) => (
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
