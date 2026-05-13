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
import TournamentTabs from "@/components/TournamentTabs";

export const dynamic = "force-dynamic";

const MARKET_LABELS: Record<string, string> = {
  win: "Win", t5: "Top 5", t10: "Top 10", t20: "Top 20", t40: "Top 40", mc: "Make Cut",
  r1lead: "R1 Leader", r2lead: "R2 Leader", r3lead: "R3 Leader",
};

const TIER1_TYPES = ["win", "t5", "t10", "t20", "t40", "mc"];

export default async function TournamentPage({ searchParams }: { searchParams: Promise<{ id?: string; mt?: string }> }) {
  const { id, mt = "win" } = await searchParams;
  if (!id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/golf/tournament?id=${id}`);

  // Tier guard — free can only view the Win market
  if (!canSeeMarket(tier, mt)) {
    return <Locked tier={tier} marketType={mt} tournamentId={id} />;
  }

  const [info, comparison, prefs] = await Promise.all([
    fetchTournamentInfo(id),
    fetchComparison(id, mt),
    getUserPreferences(),
  ]);

  // Recompute edges with user prefs applied (home_book or excluded_books)
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
    ? `Your book (${prefs.home_book})`
    : prefs.excluded_books.length
      ? `Books median (excl. ${prefs.excluded_books.join(", ")})`
      : "Books median";

  const tierInfo = TIER_BY_KEY[tier];
  const availableTabs = TIER1_TYPES.filter((t) => (info?.stats.markets_by_type[t] || 0) > 0);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground">← Tournaments</Link>
          <div className="font-semibold text-sm">{info?.tournament?.name || "Tournament"}</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <TournamentTabs tournamentId={id} active="outrights" matchupCount={info?.stats.total_matchups} marketCount={info?.stats.total_markets} proRequired={tier === "free"} />

        {/* Market type tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border/40 mb-5 pb-1">
          {availableTabs.map((t) => {
            const allowed = canSeeMarket(tier, t);
            const isActive = mt === t;
            return (
              <Link
                key={t}
                href={`/golf/tournament?id=${id}&mt=${t}`}
                className={[
                  "px-3 py-1.5 text-sm rounded transition flex items-center gap-1",
                  isActive
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                    : allowed
                    ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    : "text-muted-foreground/40",
                ].join(" ")}
              >
                {!allowed && <Lock className="h-3 w-3" />}
                <span>{MARKET_LABELS[t] || t}</span>
                <span className="text-xs opacity-60">{info?.stats.markets_by_type[t] || 0}</span>
              </Link>
            );
          })}
        </div>

        {tier === "free" && (
          <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            You&apos;re seeing the headline <strong>Win</strong> market only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro</Link> to unlock Top 5/10/20, Make Cut, props, matchups, and your home-book preference.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {MARKET_LABELS[mt] || mt} · {rows.length} players · Edge vs <span className="text-emerald-400">{referenceLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right text-amber-400">Kalshi</TableHead>
                  <TableHead className="text-right text-sky-400">DG model</TableHead>
                  <TableHead className="text-right">Books med</TableHead>
                  <TableHead className="text-right">Reference</TableHead>
                  <TableHead className="text-right">Buy edge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const e = r._user_edge.edge;
                  const edgeCls = e == null ? "text-muted-foreground"
                    : e >= 0.03 ? "text-emerald-400 font-semibold"
                    : e >= 0.005 ? "text-emerald-300"
                    : e <= -0.03 ? "text-rose-400 font-semibold"
                    : e <= -0.005 ? "text-rose-300"
                    : "text-muted-foreground";
                  return (
                    <TableRow key={r.player_id}>
                      <TableCell className="font-medium">
                        {tier === "free" ? (
                          <span>{r.player?.name}</span>
                        ) : (
                          <Link href={`/golf/tournament/player?id=${id}&player_id=${r.player_id}`} className="hover:text-emerald-400 hover:underline">
                            {r.player?.name}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-300">{fmtPct(r.kalshi?.implied_prob)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sky-300">{fmtPct(r.datagolf?.dg_prob)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r.books_median)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPct(r._user_edge.reference)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${edgeCls}`}>{fmtPctSigned(e)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
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
          <CardTitle>The {MARKET_LABELS[marketType] || marketType} market is Pro-only</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;re on the <strong>{tier}</strong> plan, which includes the Win market only. Upgrade to Pro ($19/mo) to unlock all market types, per-book pricing, and your home-book edge view.
          </p>
          <div className="flex gap-2 justify-center">
            <Link href={`/golf/tournament?id=${tournamentId}&mt=win`} className={buttonVariants({ variant: "outline" })}>
              Back to Win
            </Link>
            <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
              See plans
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function fmtPct(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

function fmtPctSigned(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
