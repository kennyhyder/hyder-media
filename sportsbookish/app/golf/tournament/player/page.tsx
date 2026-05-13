import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Lock } from "lucide-react";
import { fetchPlayer } from "@/lib/matchup-data";
import { getCurrentTier, getUserPreferences, canSeeMarket } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";

export const dynamic = "force-dynamic";

const MARKET_LABELS: Record<string, string> = {
  win: "Win", t5: "Top 5", t10: "Top 10", t20: "Top 20", t40: "Top 40", mc: "Make Cut",
  r1lead: "R1 Leader", r2lead: "R2 Leader", r3lead: "R3 Leader",
  r1t5: "R1 Top 5", r1t10: "R1 Top 10", r1t20: "R1 Top 20",
  r2t5: "R2 Top 5", r2t10: "R2 Top 10",
  r3t5: "R3 Top 5", r3t10: "R3 Top 10",
  eagle: "Eagle in Round", low_score: "Lowest Round Score",
};

const MARKET_GROUPS: { label: string; types: string[] }[] = [
  { label: "Tournament outrights", types: ["win", "t5", "t10", "t20", "t40", "mc"] },
  { label: "Round leaders", types: ["r1lead", "r2lead", "r3lead"] },
  { label: "Round top N", types: ["r1t5", "r1t10", "r1t20", "r2t5", "r2t10", "r3t5", "r3t10"] },
  { label: "Props", types: ["eagle", "low_score"] },
];

export default async function PlayerPage({ searchParams }: { searchParams: Promise<{ id?: string; player_id?: string }> }) {
  const { id, player_id } = await searchParams;
  if (!id || !player_id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/golf/tournament/player?id=${id}&player_id=${player_id}`);

  // Player detail is Pro+ (free only sees aggregated outright table)
  if (tier === "free") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle>Player detail is a Pro feature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>See every market and matchup a single player is in, with edges vs your home book. Pro plan ($19/mo).</p>
            <div className="flex gap-2 justify-center">
              <Link href={`/golf/tournament?id=${id}`} className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>Upgrade</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [data, prefs] = await Promise.all([
    fetchPlayer(player_id, id),
    getUserPreferences(),
  ]);
  if (!data) redirect(`/golf/tournament?id=${id}`);

  const tierInfo = TIER_BY_KEY[tier];
  // Filter markets by tier (free wouldn't reach here, but pro/elite see all)
  const visibleMarkets = data.markets.filter((m) => canSeeMarket(tier, m.market_type));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href={`/golf/tournament?id=${id}`} className="text-sm text-muted-foreground hover:text-foreground">← {data.tournament.name}</Link>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{data.player.name}</h1>
          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-3">
            {data.player.country && <span>{data.player.country}</span>}
            {data.player.owgr_rank != null && <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">OWGR #{data.player.owgr_rank}</Badge>}
            <span>at {data.tournament.name}</span>
            <span className="ml-auto text-xs">
              Edge vs {prefs.home_book ? <strong className="text-emerald-300">{prefs.home_book}</strong> : "book median"}
            </span>
          </div>
        </div>

        {MARKET_GROUPS.map((group) => {
          const rows = visibleMarkets
            .filter((m) => group.types.includes(m.market_type))
            .sort((a, b) => group.types.indexOf(a.market_type) - group.types.indexOf(b.market_type));
          if (!rows.length) return null;
          return (
            <Card key={group.label}>
              <CardHeader>
                <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">{group.label}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Market</TableHead>
                      <TableHead className="text-right text-amber-400">Kalshi</TableHead>
                      <TableHead className="text-right text-sky-400">DG</TableHead>
                      <TableHead className="text-right">Books med</TableHead>
                      <TableHead className="text-right">Best book</TableHead>
                      <TableHead className="text-right">Buy edge</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      // edge against home_book if set, else books_median
                      let edge = r.edge_vs_books_median;
                      let ref = r.books_median;
                      if (prefs.home_book && r.book_prices[prefs.home_book]?.novig != null && r.kalshi?.implied_prob != null) {
                        const homeP = r.book_prices[prefs.home_book].novig!;
                        edge = Number((homeP - r.kalshi.implied_prob).toFixed(4));
                        ref = homeP;
                      }
                      const cls = edge == null ? "text-muted-foreground" : edge >= 0.03 ? "text-emerald-400 font-semibold" : edge <= -0.03 ? "text-rose-400 font-semibold" : edge >= 0 ? "text-emerald-300" : "text-rose-300";
                      return (
                        <TableRow key={r.market_id}>
                          <TableCell className="font-medium">{MARKET_LABELS[r.market_type] || r.market_type}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-300">{fmtPct(r.kalshi?.implied_prob)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sky-300">{fmtPct(r.datagolf?.dg_prob)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(ref)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(r.books_min)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${cls}`}>{fmtPctSigned(edge)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}

        {data.matchups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Matchups ({data.matchups.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.matchups.map((m) => (
                <div key={m.matchup_id} className="border border-border/40 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-muted/20 border-b border-border/40 text-xs text-muted-foreground flex justify-between">
                    <span>{m.title}</span>
                    <span>
                      <Badge className={m.matchup_type === "h2h" ? "bg-sky-500/15 text-sky-300 hover:bg-sky-500/15" : "bg-purple-500/15 text-purple-300 hover:bg-purple-500/15"}>{m.matchup_type === "h2h" ? "H2H" : "3-Ball"}</Badge>
                      {m.round_number != null && <Badge className="ml-1 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">R{m.round_number}</Badge>}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {m.legs.map((leg) => (
                      <div key={leg.matchup_player_id} className={`px-3 py-2 flex items-center justify-between text-sm ${leg.is_self ? "bg-emerald-500/5" : ""}`}>
                        <span className={leg.is_self ? "font-semibold text-emerald-300" : "text-foreground"}>
                          {leg.is_self ? "→ " : ""}{leg.player?.name}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-amber-300 tabular-nums">K {fmtPct(leg.kalshi?.implied_prob)}</span>
                          {leg.book_count > 0 && <span className="text-muted-foreground tabular-nums">Books {fmtPct(leg.books_median)}</span>}
                          {leg.edge_vs_books_median != null && (
                            <span className={`tabular-nums ${leg.edge_vs_books_median > 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPctSigned(leg.edge_vs_books_median)}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(2)}%`;
}
function fmtPctSigned(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
