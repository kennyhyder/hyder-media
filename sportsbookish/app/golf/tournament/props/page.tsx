import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { fetchTournamentInfo } from "@/lib/golf-data";
import { fetchProps, type PropEvent } from "@/lib/props-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import { fmtPct, PROP_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PropsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) redirect("/golf");

  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/golf/tournament/props?id=${id}`);

  if (tier === "free") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle>Props are a Pro feature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>Winning score, margin of victory, winner region, holes-in-one — multi-outcome markets are part of the Pro plan ($19/mo).</p>
            <div className="flex gap-2 justify-center">
              <Link href={`/golf/tournament?id=${id}`} className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>Upgrade</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [info, props] = await Promise.all([
    fetchTournamentInfo(id),
    fetchProps(id),
  ]);
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
          <Link href={`/golf/tournament?id=${id}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {info?.tournament?.name || "Tournament"}</Link>
          <div className="font-semibold text-sm">Props</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-[1600px] px-4 py-6">
        {props.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No prop markets posted for this tournament right now.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {props.map((p) => <PropCard key={p.id} prop={p} />)}
        </div>

        <div className="mt-6 text-xs text-muted-foreground space-y-1">
          <p>
            Multi-outcome props are Kalshi-only — no DataGolf overlay. For mutually exclusive props (winning score, margin, region) the implied probabilities should sum to ~1.00 — anything materially over is Kalshi&apos;s overround.
            Hole-in-One thresholds are cumulative (1+ includes 2+ includes 3+), so probabilities decrease as the threshold rises.
          </p>
        </div>
      </main>
    </div>
  );
}

function PropCard({ prop }: { prop: PropEvent }) {
  const sorted = [...prop.outcomes].sort((a, b) => (b.kalshi?.implied_prob ?? 0) - (a.kalshi?.implied_prob ?? 0));
  const maxProb = Math.max(...sorted.map((o) => o.kalshi?.implied_prob ?? 0), 0.01);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 border-b border-border/40">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">{PROP_LABELS[prop.prop_type] || prop.prop_type}</div>
        <CardTitle className="text-base font-medium">{prop.question}</CardTitle>
        <div className="flex items-center gap-3 mt-1 text-[10px]">
          <span className={`uppercase tracking-wide px-1.5 py-0.5 rounded ${
            prop.outcome_kind === "mutually_exclusive" ? "bg-sky-500/15 text-sky-300" : "bg-purple-500/15 text-purple-300"
          }`}>
            {prop.outcome_kind === "mutually_exclusive" ? "Pick one" : "Cumulative"}
          </span>
          <span className="text-muted-foreground tabular-nums">
            Sum: <span className={prop.sum_implied > 1.1 ? "text-amber-400" : prop.sum_implied < 0.9 ? "text-rose-400" : "text-foreground/80"}>{fmtPct(prop.sum_implied)}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border/40">
        {sorted.map((o) => (
          <div key={o.id} className="px-4 py-2">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-sm">{o.label}</span>
              <span className="text-sm font-semibold tabular-nums text-amber-300">{fmtPct(o.kalshi?.implied_prob)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${Math.max(0, Math.min(100, ((o.kalshi?.implied_prob ?? 0) / maxProb) * 100))}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
