import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentTier, getUserPreferences } from "@/lib/tier-guard";
import { fetchTournamentInfo } from "@/lib/golf-data";
import { fetchMatchups, type Matchup } from "@/lib/matchup-data";
import { TIER_BY_KEY } from "@/lib/tiers";
import TournamentTabs from "@/components/TournamentTabs";
import PaywallCard from "@/components/PaywallCard";

export const dynamic = "force-dynamic";

export default async function MatchupsPage({ searchParams }: { searchParams: Promise<{ id?: string; type?: string }> }) {
  const { id, type } = await searchParams;
  if (!id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  const isAnonymous = !userId;

  // Free / anonymous blocked from matchups
  if (tier === "free") {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
        <PaywallCard
          feature="Matchups are a Pro feature"
          description="Head-to-head and 3-ball matchups are part of the Pro plan. See every Kalshi matchup with book consensus + buy edges per leg."
          isAnonymous={isAnonymous}
          requiredTier="pro"
          next={`/golf/tournament/matchups?id=${id}`}
        />
      </div>
    );
  }

  const [info, data, prefs] = await Promise.all([
    fetchTournamentInfo(id),
    fetchMatchups(id, type),
    getUserPreferences(),
  ]);

  const tierInfo = TIER_BY_KEY[tier];
  const h2h = data.matchups.filter((m) => m.matchup_type === "h2h").length;
  const threeBall = data.matchups.filter((m) => m.matchup_type === "3ball").length;

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
        <TournamentTabs tournamentId={id} active="matchups" matchupCount={info?.stats.total_matchups} marketCount={info?.stats.total_markets} proRequired={false} />

        <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
          {(["all", "h2h", "3ball"] as const).map((t) => {
            const isActive = (type || "all") === t;
            const count = t === "all" ? data.matchups.length : t === "h2h" ? h2h : threeBall;
            return (
              <Link
                key={t}
                href={t === "all" ? `/golf/tournament/matchups?id=${id}` : `/golf/tournament/matchups?id=${id}&type=${t}`}
                className={[
                  "px-3 py-1 text-xs rounded",
                  isActive ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                ].join(" ")}
              >
                {t === "all" ? "All" : t === "h2h" ? "H2H" : "3-Ball"} <span className="opacity-60">{count}</span>
              </Link>
            );
          })}
          <div className="ml-auto text-xs text-muted-foreground">
            Edge vs {prefs.home_book ? <strong className="text-emerald-300">{prefs.home_book}</strong> : "book median"}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.matchups.map((m) => <MatchupCard key={m.id} matchup={m} tournamentId={id} />)}
          {data.matchups.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-8">No matchups posted for this tournament right now.</div>
          )}
        </div>
      </main>
    </div>
  );
}

function MatchupCard({ matchup, tournamentId }: { matchup: Matchup; tournamentId: string }) {
  const sorted = [...matchup.players].sort((a, b) => (b.kalshi?.implied_prob ?? 0) - (a.kalshi?.implied_prob ?? 0));
  const hasBooks = matchup.players.some((p) => p.book_count > 0);
  const typeLabel = matchup.matchup_type === "h2h" ? "H2H" : matchup.matchup_type === "3ball" ? "3-Ball" : "5-Ball";
  const typeBg = matchup.matchup_type === "h2h" ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-purple-500/15 text-purple-300 border-purple-500/30";
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 border-b border-border/60">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground leading-tight">{matchup.title}</div>
          <div className="flex items-center gap-1 shrink-0">
            <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${typeBg}`}>{typeLabel}</span>
            {matchup.round_number != null && <Badge className="bg-amber-500/15 text-amber-300 text-[10px] hover:bg-amber-500/15">R{matchup.round_number}</Badge>}
            {!hasBooks && <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-amber-500/10 text-amber-400/80 border border-amber-500/20">Kalshi only</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border/40">
        {sorted.map((p) => {
          const edge = p.edge_vs_books_median;
          const edgeCls = edge == null ? "text-muted-foreground" : edge >= 0.03 ? "text-emerald-400" : edge <= -0.03 ? "text-rose-400" : edge >= 0 ? "text-emerald-300" : "text-rose-300";
          const kProb = p.kalshi?.implied_prob;
          return (
            <div key={p.matchup_player_id} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <Link
                  href={`/golf/tournament/player?id=${tournamentId}&player_id=${p.player_id}`}
                  className="text-sm font-semibold hover:text-emerald-400"
                >
                  {p.player?.name}
                </Link>
                {edge != null && <span className={`text-sm tabular-nums ${edgeCls}`}>{fmtPctSigned(edge)}</span>}
              </div>
              {p.book_count > 0 ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-[9px] uppercase text-muted-foreground">Kalshi</div><div className="tabular-nums text-amber-300">{fmtPct(kProb)}</div></div>
                  <div><div className="text-[9px] uppercase text-muted-foreground">Books med ({p.book_count})</div><div className="tabular-nums">{fmtPct(p.books_median)}</div></div>
                  <div><div className="text-[9px] uppercase text-muted-foreground">Best book</div><div className="tabular-nums">{fmtPct(p.books_min)}</div></div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (kProb ?? 0) * 100))}%` }} />
                  </div>
                  <span className="text-sm tabular-nums text-amber-300 font-medium">{fmtPct(kProb)}</span>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}
function fmtPctSigned(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
