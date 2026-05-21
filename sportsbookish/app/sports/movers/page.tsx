import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { getCurrentTier } from "@/lib/tier-guard";
import { fetchMovements } from "@/lib/movements-data";
import { fetchLeagues } from "@/lib/sports-data";
import { fmtPctSigned } from "@/lib/format";
import UpsellBanner from "@/components/UpsellBanner";
import { JsonLd } from "@/lib/seo";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

const SPORT_ICON: Record<string, string> = { nba: "🏀", mlb: "⚾", nhl: "🏒", epl: "⚽", mls: "⚽" };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function MoversPage({ searchParams }: { searchParams: Promise<{ league?: string; hours?: string }> }) {
  const params = await searchParams;
  const league = params.league || undefined;
  const hours = Math.min(Number(params.hours) || 24, 24 * 7);

  const { tier, userId } = await getCurrentTier();
  const isAnonymous = !userId;

  const [leagues, movements] = await Promise.all([
    fetchLeagues(),
    fetchMovements({ sinceHours: hours, league, minDelta: tier === "free" ? 0.05 : 0.02 }),
  ]);

  const ups = movements.filter((m) => m.direction === "up");
  const downs = movements.filter((m) => m.direction === "down");

  // Freshness = latest movement's fired_at, or render time as floor
  const movementsFreshest = movements.length > 0
    ? movements.reduce((max, m) => {
        const t = m.fired_at ? new Date(m.fired_at).getTime() : 0;
        return t > max ? t : max;
      }, 0)
    : 0;
  const freshestAt = movementsFreshest ? new Date(movementsFreshest).toISOString() : new Date().toISOString();

  return (
    <div className="min-h-screen">
      <JsonLd data={datasetFreshnessLd({
        name: `Top Kalshi movers — ${league ? league.toUpperCase() : "all sports"} (last ${hours}h)`,
        description: `Live ledger of the largest Kalshi event-contract price movements in the last ${hours} hours across ${league ? league.toUpperCase() : "all sports"}. Detected every 5 minutes.`,
        pageUrl: `${SITE_URL}/sports/movers${league ? `?league=${league}` : ""}`,
        dateModified: freshestAt,
        variableMeasured: ["Price delta", "Kalshi implied probability change", "Movement direction"],
      })} />
      {isAnonymous && <UpsellBanner variant="anonymous" next="/sports/movers" />}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4 gap-2">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground/80 shrink-0">← Sports</Link>
          <div className="flex items-center gap-2 font-semibold text-sm truncate">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <span>Top Movers</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LastUpdated iso={freshestAt} variant="header" />
            {isAnonymous && (
              <Link href="/signup?next=/sports/movers" className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 font-semibold">Sign up free</Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <div className="flex items-center gap-1">
            <Link href="/sports/movers" className={`px-3 py-1 text-xs rounded ${!league ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>All sports</Link>
            {leagues.map((l) => (
              <Link key={l.key} href={`/sports/movers?league=${l.key}`} className={`px-3 py-1 text-xs rounded ${league === l.key ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                {l.icon} {l.display_name}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Last:</span>
            {[1, 6, 24, 72, 168].map((h) => (
              <Link key={h} href={`/sports/movers?${league ? `league=${league}&` : ""}hours=${h}`} className={`px-2 py-1 text-xs rounded ${hours === h ? "bg-amber-500/15 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}>
                {h < 24 ? `${h}h` : `${h / 24}d`}
              </Link>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{movements.length} moves (≥{tier === "free" ? "5" : "2"}%)</div>
        </div>

        {tier === "free" && (
          <div className="mb-5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            {isAnonymous ? (
              <><strong>Anonymous view:</strong> moves ≥5%. <Link href="/signup?next=/sports/movers" className="text-emerald-400 hover:underline">Sign up free</Link>, then <Link href="/pricing" className="text-emerald-400 hover:underline">upgrade to Pro</Link> to see ≥2% moves and Elite for live email + SMS alerts.</>
            ) : (
              <>Free tier shows moves ≥5%. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade</Link> to see moves ≥2% and add Elite to receive these as live email + SMS alerts.</>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-400" /> Up moves ({ups.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border/40 max-h-[600px] overflow-y-auto">
              {ups.length === 0 && <div className="text-center text-muted-foreground py-6">No qualifying moves in window.</div>}
              {ups.map((m) => <MoveRow key={m.id} m={m} />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4 text-rose-400" /> Down moves ({downs.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border/40 max-h-[600px] overflow-y-auto">
              {downs.length === 0 && <div className="text-center text-muted-foreground py-6">No qualifying moves in window.</div>}
              {downs.map((m) => <MoveRow key={m.id} m={m} />)}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function MoveRow({ m }: { m: import("@/lib/movements-data").Movement }) {
  const isUp = m.direction === "up";
  return (
    <Link href={`/sports/${m.league}/event/${m.event_id}`} className="block px-4 py-3 hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm">{SPORT_ICON[m.league] || "🎯"}</span>
            <span className="text-xs uppercase text-muted-foreground">{m.league}</span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] text-muted-foreground/60">{timeAgo(m.fired_at)}</span>
          </div>
          <div className="font-semibold text-sm truncate">{m.contestant_label}</div>
          <div className="text-xs text-muted-foreground truncate">{m.event_title}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-lg font-bold tabular-nums ${isUp ? "text-emerald-400" : "text-rose-400"}`}>{fmtPctSigned(m.delta)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{(m.prob_baseline * 100).toFixed(1)}% → {(m.prob_now * 100).toFixed(1)}%</div>
        </div>
      </div>
    </Link>
  );
}
