import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchLeagues, fetchLeagueData, type InlineMarket, type SportsEvent } from "@/lib/sports-data";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, edgeTextClass } from "@/lib/format";
import { eventUrl, slugify } from "@/lib/slug";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

// Minimum edge to surface — 1.5pp keeps the table actionable without noise.
const MIN_EDGE = 0.015;
// Skip markets resolving to extremes — already-settled doesn't count.
const HARD_MIN = 0.04;
const HARD_MAX = 0.96;

const LEAGUE_DISPLAY: Record<string, string> = {
  nba: "NBA", mlb: "MLB", nhl: "NHL", nfl: "NFL", ncaaf: "College Football",
  epl: "EPL", mls: "MLS", ucl: "UCL", wc: "World Cup", pga: "PGA",
};

const TITLE = "Positive EV Bets Today — Live +EV Finder | SportsBookISH";
const DESC = "Every +EV opportunity across MLB, NBA, NFL, NHL, college, soccer and golf right now. Kalshi event-contract prices vs the sportsbook consensus, sorted by edge. Updated continuously.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/sports/positive-ev` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/sports/positive-ev`, siteName: "SportsBookISH", type: "website" },
};

interface ScannerRow {
  edge: number;                 // books_median - kalshi (positive = Kalshi cheaper)
  edge_vs_best: number | null;  // best-book bound (sharper signal)
  league: string;
  league_display: string;
  event: SportsEvent;
  market: InlineMarket;
  kalshi_pct: number;
  books_median_pct: number | null;
  best_book: { book: string; american: number | null } | null;
  start_time: string | null;
}

const HUB_FAQ = [
  {
    question: "What is +EV betting?",
    answer: "Positive expected value (+EV) betting means consistently placing wagers where the offered price is better than the true probability of the outcome. Over many bets, mathematically, profitable. SportsBookISH derives 'true probability' from the no-vig sportsbook consensus and the Kalshi exchange mid-price.",
  },
  {
    question: "How is the edge calculated?",
    answer: "Edge = (no-vig books median implied probability) − (Kalshi mid implied probability). A +5pp edge on a Kalshi YES contract means books fair-value the outcome at 5 percentage points higher probability than Kalshi is pricing it — so Kalshi is the cheaper buy.",
  },
  {
    question: "How fresh is this data?",
    answer: "Kalshi quotes refresh every 5 minutes. Sportsbook quotes every 15-30 minutes. Polymarket every 15 minutes. The page rerenders on every visit so the table is never older than your most recent page load.",
  },
  {
    question: "Why are settled markets filtered out?",
    answer: "Markets with implied probability under 4% or above 96% have effectively resolved (the favored side has won or the underdog can no longer win). We hide those because their 'edge' is misleading — it's settlement, not opportunity.",
  },
];

export default async function PositiveEVPage() {
  const leagues = await fetchLeagues();
  const renderTime = new Date().toISOString();

  // Pull events across every active league in parallel
  const leagueData = await Promise.all(
    leagues.map((l) => fetchLeagueData(l.key).then((d) => ({ league: l.key, ...d })))
  );

  const scannerRows: ScannerRow[] = [];
  for (const ld of leagueData) {
    for (const ev of ld.events) {
      for (const m of (ev.markets || [])) {
        const kalshi = m.implied_prob;
        const median = m.books_median;
        if (kalshi == null || median == null) continue;
        // Hard filter on extremes (settled / pre-resolution)
        if (kalshi < HARD_MIN || kalshi > HARD_MAX) continue;
        const edge = median - kalshi;
        if (edge < MIN_EDGE) continue;
        // Require at least 2 books in the median (single book = noise)
        if ((m.books_count ?? 0) < 2) continue;

        scannerRows.push({
          edge,
          edge_vs_best: m.edge_vs_best_book ?? null,
          league: ld.league,
          league_display: LEAGUE_DISPLAY[ld.league] || ld.league.toUpperCase(),
          event: ev,
          market: m,
          kalshi_pct: kalshi,
          books_median_pct: median,
          best_book: m.best_book ? { book: m.best_book.book, american: m.best_book.american } : null,
          start_time: ev.start_time,
        });
      }
    }
  }

  // Sort by raw edge DESC (largest opportunity first)
  scannerRows.sort((a, b) => b.edge - a.edge);

  // Cap to top 200 — page stays fast + first impression still strong.
  const top = scannerRows.slice(0, 200);

  // Per-league counts for filter chips
  const countsByLeague = new Map<string, number>();
  for (const r of top) {
    countsByLeague.set(r.league, (countsByLeague.get(r.league) || 0) + 1);
  }

  // Aggregate stats for the hero
  const stats = {
    total: top.length,
    leagues: countsByLeague.size,
    avg_edge_pct: top.length ? top.reduce((s, r) => s + r.edge, 0) / top.length : 0,
    biggest_edge: top.length ? top[0].edge : 0,
    biggest_title: top.length ? `${top[0].market.contestant_label}` : "",
  };

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sports", url: `${SITE_URL}/sports` },
        { name: "+EV Bets Today", url: `${SITE_URL}/sports/positive-ev` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: "Positive EV bets — Live Kalshi vs sportsbook consensus",
        description: DESC,
        pageUrl: `${SITE_URL}/sports/positive-ev`,
        dateModified: renderTime,
        variableMeasured: ["edge_vs_books_median", "kalshi_implied_prob", "books_median_implied_prob"],
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4 gap-2">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground shrink-0">← Sports</Link>
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
            +EV Scanner · {top.length} opportunities
          </div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Positive EV Bets — Updated Every Visit</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Every Kalshi market priced cheaper than the no-vig sportsbook consensus, ranked by edge.
            Hidden: markets under 4% or over 96% (settled), markets backed by fewer than 2 books (noise), and edges under 1.5pp.
          </p>
        </section>

        {/* Stat strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Opportunities</div>
              <div className="text-2xl font-bold tabular-nums">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Leagues active</div>
              <div className="text-2xl font-bold tabular-nums">{stats.leagues}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Avg edge</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmtPctSigned(stats.avg_edge_pct, 1)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Biggest edge</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-400">{fmtPctSigned(stats.biggest_edge, 1)}</div>
              {stats.biggest_title && <div className="text-[10px] text-muted-foreground/80 truncate">{stats.biggest_title}</div>}
            </CardContent>
          </Card>
        </section>

        {/* League chips */}
        {countsByLeague.size > 1 && (
          <section>
            <div className="flex flex-wrap gap-2 text-xs">
              <Link href="#" className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">All ({top.length})</Link>
              {Array.from(countsByLeague.entries()).sort((a, b) => b[1] - a[1]).map(([lg, n]) => (
                <Link key={lg} href={`/sports/${lg}`} className="px-2 py-1 rounded border border-border/60 text-muted-foreground hover:bg-muted/50">
                  {LEAGUE_DISPLAY[lg] || lg.toUpperCase()} ({n})
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Main scanner table */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Edge = books_median − Kalshi. Top {top.length} rows. Sorted by edge DESC.
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {top.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>No qualifying +EV opportunities right now.</p>
                <p className="text-xs mt-2">Check back during peak game-day hours (Tue-Sun PM ET) when both Kalshi and the books are most actively repricing.</p>
              </div>
            ) : (
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead className="text-right text-amber-500">Kalshi</TableHead>
                    <TableHead className="text-right text-emerald-500">Books fair</TableHead>
                    <TableHead className="text-right">Edge</TableHead>
                    <TableHead className="text-right">vs Best</TableHead>
                    <TableHead>Best price</TableHead>
                    <TableHead>League</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Books</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/40">
                  {top.map((r) => {
                    const year = r.event.season_year || (r.event.start_time ? new Date(r.event.start_time).getUTCFullYear() : new Date().getUTCFullYear());
                    const eventSlug = r.event.slug || slugify(r.event.title);
                    const href = eventSlug ? eventUrl(r.league, year, eventSlug) : `/sports/${r.league}/event/${r.event.id}`;
                    return (
                      <TableRow key={`${r.event.id}|${r.market.id}`}>
                        <TableCell className="font-medium">
                          <Link href={href} className="hover:text-emerald-400 hover:underline">
                            {r.market.contestant_label}
                          </Link>
                          <div className="text-[10px] text-muted-foreground/80 truncate max-w-[260px]">{r.event.title}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-400">{fmtPct(r.kalshi_pct, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-300">{fmtPct(r.books_median_pct, 1)}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${edgeTextClass(r.edge)}`}>{fmtPctSigned(r.edge, 1)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.edge_vs_best != null ? edgeTextClass(r.edge_vs_best) : "text-muted-foreground/40"}`}>
                          {r.edge_vs_best != null ? fmtPctSigned(r.edge_vs_best, 1) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.best_book ? (
                            <span>{bookLabel(r.best_book.book)} <span className="text-muted-foreground/80">{fmtAmerican(r.best_book.american)}</span></span>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{r.league_display}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground/80 whitespace-nowrap">
                          {r.start_time ? new Date(r.start_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground/80">{r.market.books_count ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Methodology + FAQ */}
        <section>
          <h2 className="text-xl font-bold mb-3">How this works</h2>
          <Card>
            <CardContent className="p-4 space-y-3 text-sm">
              <p>SportsBookISH ingests Kalshi event-contract prices every 5 minutes from the official Kalshi API, sportsbook consensus from 14+ regulated US books every 15-30 minutes via The Odds API, and Polymarket prices every 15 minutes. Every quote is timestamped and stored.</p>
              <p>For each market we compute the no-vig implied probability per book (stripping the bookmaker margin), take the median across books, and compare it to the Kalshi YES mid-price. If books say it should be 52% and Kalshi has it at 47%, you have +5pp expected value buying YES on Kalshi.</p>
              <p>We hide markets at extremes (under 4%, over 96%) because their movement is settlement not signal, and markets backed by fewer than 2 books because a single quote is noise. The table refreshes on every page load.</p>
            </CardContent>
          </Card>
        </section>

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
