import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

interface Alert {
  id: string;
  tournament_id: string;
  player_id: string;
  market_type: string;
  direction: "buy" | "sell";
  edge_value: number;
  kalshi_prob: number;
  reference_prob: number;
  book_count: number;
  fired_at: string;
  notified_at: string | null;
  golfodds_players: { name: string } | null;
  golfodds_tournaments: { name: string; kalshi_event_ticker: string | null } | null;
}

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

async function fetchAlerts(): Promise<Alert[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/alerts?since_hours=72&limit=200`, { next: { revalidate: 30 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.alerts || [];
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function AlertsPage() {
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect("/login?next=/alerts");

  if (tier !== "elite") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle>Live alerts are Elite-only</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>Every 5 min the engine scans for edges crossing ±3%/5% with 3+ books confirming, then emails (and optionally texts) you the moment one fires. Elite plan, $39/mo.</p>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>See plans</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const alerts = await fetchAlerts();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">⚡ Live Edge Alerts</div>
          <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Elite</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Last 72 hours · {alerts.length} alerts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-left">Tournament</th>
                  <th className="px-3 py-2 text-center">Dir</th>
                  <th className="px-3 py-2 text-right">Edge</th>
                  <th className="px-3 py-2 text-right text-amber-400">Kalshi</th>
                  <th className="px-3 py-2 text-right">Books</th>
                  <th className="px-3 py-2 text-right">#</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {alerts.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.fired_at)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/golf/tournament/player?id=${a.tournament_id}&player_id=${a.player_id}`} className="hover:text-emerald-400 hover:underline">
                        {a.golfodds_players?.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{a.market_type}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{a.golfodds_tournaments?.name}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${
                        a.direction === "buy" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                      }`}>{a.direction}</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${a.direction === "buy" ? "text-emerald-400" : "text-rose-400"}`}>
                      {a.edge_value >= 0 ? "+" : ""}{(a.edge_value * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-300">{(a.kalshi_prob * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(a.reference_prob * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">{a.book_count}</td>
                  </tr>
                ))}
                {alerts.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No alerts in the last 72 hours.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
