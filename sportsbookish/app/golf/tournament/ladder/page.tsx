import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { fetchTournamentInfo } from "@/lib/golf-data";
import { fetchLadder } from "@/lib/props-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import { fmtPct, fmtPctSigned, edgeTextClass, MARKET_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPES = ["win", "t5", "t10", "t20", "mc"];

const SOURCE_LABEL: Record<string, string> = {
  kalshi_p: "Kalshi",
  dg_p: "DG model",
  books_median_p: "Books median",
};

export default async function LadderPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/golf/tournament/ladder?id=${id}`);

  if (tier === "free") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle>Ladder view is a Pro feature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>See every player&apos;s Win → T5 → T10 → T20 → Make Cut probability ladder side-by-side from Kalshi, DataGolf model, and book consensus. Flags internal-consistency violations (e.g., Kalshi T20 prob lower than T10).</p>
            <div className="flex gap-2 justify-center">
              <Link href={`/golf/tournament?id=${id}`} className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>Upgrade</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [info, rows] = await Promise.all([fetchTournamentInfo(id), fetchLadder(id)]);
  const tierInfo = TIER_BY_KEY[tier];
  const issuesCount = rows.filter((r) => r.issues.length > 0).length;
  const kalshiCount = rows.filter((r) => r.has_kalshi_data).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4">
          <Link href={`/golf/tournament?id=${id}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {info?.tournament?.name || "Tournament"}</Link>
          <div className="font-semibold text-sm">Ladder · Internal consistency</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-[1800px] px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Players</div><div className="text-2xl font-bold">{rows.length}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">With Kalshi data</div><div className="text-2xl font-bold text-amber-400">{kalshiCount}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Consistency issues</div><div className={`text-2xl font-bold ${issuesCount > 0 ? "text-rose-400" : "text-emerald-400"}`}>{issuesCount}</div></CardContent></Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Each row is one player. Each market type shows three probability values: <span className="text-amber-400">K</span>alshi · <span className="text-sky-400">DG</span> · <span className="text-foreground/80">Bk</span> (book median). Win ≤ T5 ≤ T10 ≤ T20 should always hold; violations flagged in Issues.</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground border-r border-border/40">Player</th>
                  {TYPES.map((mt) => (
                    <th key={mt} colSpan={3} className="px-2 py-1 text-center text-xs uppercase tracking-wide text-foreground/80 border-r border-border/40">{MARKET_LABELS[mt]}</th>
                  ))}
                  <th rowSpan={2} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Issues</th>
                </tr>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {TYPES.map((mt) => (
                    <>
                      <th key={`${mt}-k`} className="px-1 py-1 text-right text-amber-400">K</th>
                      <th key={`${mt}-d`} className="px-1 py-1 text-right text-sky-400">DG</th>
                      <th key={`${mt}-b`} className="px-1 py-1 text-right text-muted-foreground border-r border-border/40">Bk</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => (
                  <tr key={r.player_id} className="hover:bg-muted/40">
                    <td className="px-3 py-1.5 whitespace-nowrap border-r border-border/40">
                      <Link href={`/golf/tournament/player?id=${id}&player_id=${r.player_id}`} className="hover:text-emerald-400 hover:underline">
                        {r.player?.name}
                      </Link>
                      {r.has_kalshi_data && <span className="ml-2 text-[10px] text-amber-400/70">●K</span>}
                    </td>
                    {TYPES.map((mt) => {
                      const e = r.markets[mt];
                      return (
                        <>
                          <td key={`${r.player_id}-${mt}-k`} className="px-1 py-1 text-right tabular-nums text-amber-300">{fmtPct(e?.kalshi_p, 2)}</td>
                          <td key={`${r.player_id}-${mt}-d`} className="px-1 py-1 text-right tabular-nums text-sky-300">{fmtPct(e?.dg_p, 2)}</td>
                          <td key={`${r.player_id}-${mt}-b`} className="px-1 py-1 text-right tabular-nums text-muted-foreground border-r border-border/40">{fmtPct(e?.books_median_p, 2)}</td>
                        </>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right text-xs">
                      {r.issues.length === 0 ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          {r.issues.map((iss, i) => (
                            <span key={i} className={`${edgeTextClass(-iss.delta)} text-[10px]`}>
                              {SOURCE_LABEL[iss.source] || iss.source}: {iss.kind} ({fmtPctSigned(-iss.delta, 2)})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={17} className="px-3 py-8 text-center text-muted-foreground">No ladder data — Kalshi may not yet have T5/T10/T20 markets posted for this event.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
