import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { fetchTournamentInfo, fetchComparison, computeEdgeForRow, type PlayerComparisonRow } from "@/lib/golf-data";
import { getCurrentTier, getUserPreferences, canSeeMarket } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import { MARKET_LABELS, fmtPct, fmtPctSigned, fmtAmerican, bookLabel, edgeTextClass, edgeBgClass } from "@/lib/format";
import MarketTabs from "@/components/MarketTabs";
import BestBetsCards from "@/components/BestBetsCards";
import TournamentTabs from "@/components/TournamentTabs";

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
          <Link href="/golf" className="text-sm text-neutral-500 hover:text-neutral-300">← Tournaments</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>⛳</span>
            <span>{info?.tournament?.name || "Tournament"}</span>
            {info?.tournament?.is_major && <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Major</Badge>}
          </div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
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
            <CardTitle className="text-sm font-normal text-neutral-400">
              {MARKET_LABELS[mt] || mt} · {rows.length} players · Edge vs <span className="text-emerald-400">{referenceLabel}</span>
              {!isPaidTier && <span className="ml-3 text-amber-400 text-xs">Free tier — showing 5 of {books.length} books. <Link href="/pricing" className="underline hover:text-amber-300">Upgrade for all</Link></span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right text-amber-400">Kalshi</TableHead>
                  <TableHead className="text-right text-sky-400">DG</TableHead>
                  <TableHead className="text-right">Books med</TableHead>
                  <TableHead className="text-right">Buy edge</TableHead>
                  <TableHead className="text-right">vs DG</TableHead>
                  <TableHead className="text-right">vs best book</TableHead>
                  {visibleBooks.map((b) => (
                    <TableHead key={b} className="text-right text-xs" title={bookLabel(b)}>{bookLabel(b)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const userEdge = r._user_edge.edge;
                  const dgEdge = r.edge_vs_dg;
                  const bestEdge = r.edge_vs_best_book;
                  return (
                    <TableRow key={r.player_id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {isPaidTier ? (
                          <Link href={`/golf/tournament/player?id=${id}&player_id=${r.player_id}`} className="hover:text-emerald-400 hover:underline">
                            {r.player?.name}
                          </Link>
                        ) : (
                          <span>{r.player?.name}</span>
                        )}
                        {r.kalshi?.implied_prob != null && <span className="ml-2 text-[10px] text-amber-400/70">●K</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-300">{fmtPct(r.kalshi?.implied_prob)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sky-300">{fmtPct(r.datagolf?.dg_prob)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r.books_median)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${edgeTextClass(userEdge)} ${edgeBgClass(userEdge)}`}>
                        {fmtPctSigned(userEdge)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${edgeTextClass(dgEdge)}`}>{fmtPctSigned(dgEdge)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${edgeTextClass(bestEdge)}`}>
                        {fmtPctSigned(bestEdge)}
                        {r.best_book_for_bet && (
                          <div className="text-[10px] text-neutral-500">
                            {bookLabel(r.best_book_for_bet.book)} {fmtAmerican(r.best_book_for_bet.price_american)}
                          </div>
                        )}
                      </TableCell>
                      {visibleBooks.map((b) => {
                        const px = r.book_prices[b];
                        return (
                          <TableCell key={b} className="text-right tabular-nums text-neutral-400">
                            {px ? (
                              <span title={`american ${fmtAmerican(px.american)}, no-vig ${fmtPct(px.novig)}`}>
                                {fmtPct(px.novig)}
                              </span>
                            ) : (
                              <span className="text-neutral-700">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleBooks.length + 7} className="text-center py-8 text-neutral-500">
                      No data for this market type. Kalshi T5/T10/T20 coverage is inconsistent outside majors.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="mt-4 text-xs text-neutral-500 space-y-1">
          <p>
            <span className="text-amber-300">Kalshi</span> = implied prob from bid/ask mid (or last trade if spread wide).{" "}
            <span className="text-sky-300">DG</span> = DataGolf model baseline.{" "}
            <span className="text-neutral-300">Books</span> = de-vigged implied prob per book.
          </p>
          <p>
            <strong className="text-neutral-300">Buy edge = reference − Kalshi.</strong>{" "}
            <span className="text-emerald-300">Positive (green)</span> = Kalshi cheaper than reference → good <strong>buy</strong>.{" "}
            <span className="text-rose-300">Negative (red)</span> = Kalshi overpriced → <strong>sell</strong> or bet at the books.{" "}
            &ldquo;Edge vs best&rdquo; compares Kalshi to the book offering the longest American odds.
          </p>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "kalshi" | "dg" }) {
  const cls = tone === "kalshi" ? "text-amber-300" : tone === "dg" ? "text-sky-300" : "text-neutral-100";
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
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
            <Lock className="h-6 w-6 text-amber-400" />
          </div>
          <CardTitle>{MARKET_LABELS[marketType] || marketType} is a Pro-only market</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-neutral-400">
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
