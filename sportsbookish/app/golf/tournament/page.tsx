import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { fetchTournamentInfo, fetchComparison, computeEdgeForRow, type PlayerComparisonRow } from "@/lib/golf-data";
import { getCurrentTier, getUserPreferences, canSeeMarket } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import { MARKET_LABELS, bookLabel } from "@/lib/format";
import MarketTabs from "@/components/MarketTabs";
import BestBetsCards from "@/components/BestBetsCards";
import TournamentTabs from "@/components/TournamentTabs";
import OutrightTable from "@/components/OutrightTable";

export const dynamic = "force-dynamic";

export default async function TournamentPage({ searchParams }: { searchParams: Promise<{ id?: string; mt?: string }> }) {
  const { id, mt = "win" } = await searchParams;
  if (!id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/golf/tournament?id=${id}`);

  const isPaidTier = tier !== "free";

  if (!canSeeMarket(tier, mt)) {
    return <Locked tier={tier} marketType={mt} tournamentId={id} />;
  }

  const [info, comparison, prefs] = await Promise.all([
    fetchTournamentInfo(id),
    fetchComparison(id, mt),
    getUserPreferences(),
  ]);

  // Re-compute edges with user prefs (home_book or excluded_books)
  const rows = comparison.players.map((p) => {
    const e = computeEdgeForRow(p, prefs.home_book, prefs.excluded_books);
    return { ...p, _user_edge: e } as PlayerComparisonRow & { _user_edge: ReturnType<typeof computeEdgeForRow> };
  });
  rows.sort((a, b) => {
    const av = a._user_edge.edge ?? -Infinity;
    const bv = b._user_edge.edge ?? -Infinity;
    return bv - av;
  });

  const referenceLabel = prefs.home_book
    ? `${bookLabel(prefs.home_book)} (home book)`
    : prefs.excluded_books.length
      ? `Books median (excl. ${prefs.excluded_books.map(bookLabel).join(", ")})`
      : "Books median";

  const tierInfo = TIER_BY_KEY[tier];
  const books = comparison.books || [];

  // Trim list of book cols for free tier (just show the major US books)
  const visibleBooks = isPaidTier ? books : books.filter((b) => ["draftkings", "fanduel", "betmgm", "caesars", "circa"].includes(b));

  // Players w/ user_edge field for BestBets cards
  const playersWithUserEdge = rows.map((r) => ({
    ...r,
    user_edge: r._user_edge.edge,
  }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground">← Tournaments</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>⛳</span>
            <span>{info?.tournament?.name || "Tournament"}</span>
            {info?.tournament?.is_major && <Badge className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/20">Major</Badge>}
          </div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-[1600px] px-4 py-6">
        <TournamentTabs tournamentId={id} active="outrights" matchupCount={info?.stats.total_matchups} marketCount={info?.stats.total_markets} proRequired={tier === "free"} />

        {/* Stats strip */}
        {info && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Players" value={String(info.stats.unique_players)} />
            <Stat label="Total markets" value={String(info.stats.total_markets)} />
            <Stat label="Kalshi quotes" value={String(info.stats.kalshi_quote_count)} tone="kalshi" />
            <Stat label="Book quotes" value={String(info.stats.book_quote_count)} />
            <Stat label="DG model" value={String(info.stats.dg_quote_count)} tone="dg" />
            <Stat label="Books tracked" value={String(info.books.length)} />
          </div>
        )}

        <MarketTabs
          tournamentId={id}
          active={mt}
          available={info?.stats.markets_by_type}
          kalshiCounts={info?.stats.kalshi_markets_by_type}
          isFreeTier={tier === "free"}
        />

        {/* Best Bets cards above the table */}
        <BestBetsCards
          players={playersWithUserEdge}
          marketType={mt}
          tournamentId={id}
          isPaidTier={isPaidTier}
          edgeField={prefs.home_book || prefs.excluded_books.length > 0 ? "user_edge" : "edge_vs_books_median"}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              {MARKET_LABELS[mt] || mt} · {rows.length} players · Edge vs <span className="text-emerald-500">{referenceLabel}</span>
              {!isPaidTier && <span className="ml-3 text-amber-500 text-xs">Free tier — showing 5 of {books.length} books. <Link href="/pricing" className="underline hover:text-amber-400">Upgrade for all</Link></span>}
              <span className="ml-3 text-muted-foreground/70 text-xs">Click any column header to sort.</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <OutrightTable
              tournamentId={id}
              books={visibleBooks}
              isPaidTier={isPaidTier}
              rows={rows.map((r) => ({
                player_id: r.player_id,
                player: r.player,
                kalshi: r.kalshi ? { implied_prob: r.kalshi.implied_prob } : null,
                datagolf: r.datagolf ? { dg_prob: r.datagolf.dg_prob } : null,
                books_median: r.books_median,
                books_min: r.books_min,
                book_count: r.book_count,
                edge_vs_books_median: r.edge_vs_books_median,
                edge_vs_dg: r.edge_vs_dg,
                edge_vs_best_book: r.edge_vs_best_book,
                best_book_for_bet: r.best_book_for_bet,
                book_prices: Object.fromEntries(
                  Object.entries(r.book_prices).map(([k, v]) => [k, { american: v.american, novig: v.novig }])
                ),
                user_edge: r._user_edge.edge,
                user_reference: r._user_edge.reference,
              }))}
            />
          </CardContent>
        </Card>

        <div className="mt-4 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="text-amber-500">Kalshi</span> = implied prob from bid/ask mid (or last trade if spread wide).{" "}
            <span className="text-sky-500">DG</span> = DataGolf model baseline.{" "}
            <span className="text-foreground/80">Books</span> = de-vigged implied prob per book.
          </p>
          <p>
            <strong className="text-foreground">Buy edge = reference − Kalshi.</strong>{" "}
            <span className="text-emerald-500">Positive (green)</span> = Kalshi cheaper than reference → good <strong>buy</strong>.{" "}
            <span className="text-rose-500">Negative (red)</span> = Kalshi overpriced → <strong>sell</strong> or bet at the books.{" "}
            &ldquo;Edge vs best&rdquo; compares Kalshi to the book offering the longest American odds.
          </p>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "kalshi" | "dg" }) {
  const cls = tone === "kalshi" ? "text-amber-500" : tone === "dg" ? "text-sky-500" : "text-foreground";
  return (
    <div className="bg-card border border-border rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function Locked({ tier, marketType, tournamentId }: { tier: string; marketType: string; tournamentId: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
            <Lock className="h-6 w-6 text-amber-500" />
          </div>
          <CardTitle>{MARKET_LABELS[marketType] || marketType} is a Pro-only market</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;re on the <strong>{tier}</strong> plan, which includes only the Win market. Upgrade to Pro ($19/mo) for all 17+ market types, per-book pricing, player detail, matchups, and props.
          </p>
          <div className="flex gap-2 justify-center">
            <Link href={`/golf/tournament?id=${tournamentId}&mt=win`} className={buttonVariants({ variant: "outline" })}>
              Back to Win
            </Link>
            <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
              Upgrade
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
