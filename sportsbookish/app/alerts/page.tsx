import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

interface FeedAlert {
  source: "golf" | "sports";
  id: string;
  sport: string | null;
  league: string;
  fired_at: string;
  alert_type: string;
  direction: string;
  delta: number;
  probability: number;
  reference: number;
  reference_label: string;
  title: string;
  subtitle: string;
  book_count: number;
  link: string;
}

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

async function fetchAllAlerts(): Promise<FeedAlert[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=72&limit=300`, { next: { revalidate: 30 } });
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

const SPORT_ICON: Record<string, string> = { golf: "⛳", pga: "⛳", nba: "🏀", mlb: "⚾", nhl: "🏒", epl: "⚽", mls: "⚽" };

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
            <p>Every 5 min the engine scans Kalshi across every sport for edge crossings (vs sportsbook consensus on golf) and price movements (≥3% in 15 min on any sport). Email + SMS delivery on Elite.</p>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>See plans</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const alerts = await fetchAllAlerts();
  const golfCount = alerts.filter((a) => a.source === "golf").length;
  const sportsCount = alerts.filter((a) => a.source === "sports").length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">⚡ Live Alerts</div>
          <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Elite</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Last 72h</div><div className="text-2xl font-bold">{alerts.length}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Golf edge alerts</div><div className="text-2xl font-bold text-emerald-400">{golfCount}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Sport movement</div><div className="text-2xl font-bold text-amber-400">{sportsCount}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Combined feed</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Sport</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-center">Dir</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                  <th className="px-3 py-2 text-right text-amber-400">Kalshi</th>
                  <th className="px-3 py-2 text-right">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {alerts.map((a) => {
                  const isBuy = a.direction === "buy" || a.direction === "up";
                  return (
                    <tr key={`${a.source}-${a.id}`} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.fired_at)}</td>
                      <td className="px-3 py-2">{SPORT_ICON[a.sport || ""] || "🎯"} <span className="text-xs uppercase">{a.league}</span></td>
                      <td className="px-3 py-2">
                        <Link href={a.link} className="hover:text-emerald-400 hover:underline">{a.title}</Link>
                        <div className="text-xs text-muted-foreground">{a.subtitle}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{a.alert_type}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${isBuy ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{a.direction}</span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                        {a.delta >= 0 ? "+" : ""}{(a.delta * 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-300">{(a.probability * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{(a.reference * 100).toFixed(1)}% <span className="text-[9px]">({a.reference_label})</span></td>
                    </tr>
                  );
                })}
                {alerts.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No alerts yet — engine scans every 5 min.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
