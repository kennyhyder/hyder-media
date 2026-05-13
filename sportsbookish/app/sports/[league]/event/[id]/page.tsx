import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchEventDetail, fetchLeagues } from "@/lib/sports-data";
import { fetchEventHistory, fetchMovements } from "@/lib/movements-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { fmtPctSigned } from "@/lib/format";
import PriceSpark from "@/components/PriceSpark";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await params;
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/sports/${league}/event/${id}`);

  const [leagues, detail, history, allMovements] = await Promise.all([
    fetchLeagues(),
    fetchEventDetail(id),
    fetchEventHistory(id, 24),
    fetchMovements({ sinceHours: 24, league, minDelta: 0.015, limit: 50 }),
  ]);
  const meta = leagues.find((l) => l.key === league);
  if (!detail || !meta) notFound();

  // movements for this specific event
  const eventMoves = allMovements.filter((m) => m.event_id === id);
  const historyByMarket = new Map(history.map((h) => [h.market_id, h]));

  // Lookup contestant_id from sports_contestants? We don't have it on markets directly...
  // We pull from contestant_label. For click-through, we need contestant_id which isn't here.
  // For V1, the click-through can be a separate query — we'll embed a /contestant?label= fallback.

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {meta.display_name}</Link>
          <div className="text-sm font-semibold capitalize">{detail.event.event_type}</div>
          <div className="w-12" />
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-3xl">{meta.icon}</span>
            <h1 className="text-3xl font-bold">{detail.event.title}</h1>
          </div>
          <div className="text-sm text-muted-foreground">
            {detail.event.start_time && new Date(detail.event.start_time).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 font-mono">{detail.event.kalshi_event_ticker}</div>
        </div>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Kalshi prices</span>
              <span className="text-xs font-normal text-muted-foreground">24h history</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {detail.markets.map((m) => {
              const p = m.implied_prob;
              const width = Math.max(0, Math.min(100, (p ?? 0) * 100));
              const hist = historyByMarket.get(m.id);
              return (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2 gap-3">
                    <div className="font-semibold flex-1 min-w-0 truncate">{m.contestant_label}</div>
                    <div className="flex items-center gap-3 shrink-0">
                      {hist && hist.points.length >= 2 && <PriceSpark points={hist.points} width={100} height={28} />}
                      <div className="text-2xl font-bold tabular-nums text-amber-300">{p != null ? `${(p * 100).toFixed(1)}%` : "—"}</div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${width}%` }} />
                  </div>
                  {(m.yes_bid != null || m.yes_ask != null) && (
                    <div className="text-xs text-muted-foreground mt-2 tabular-nums">
                      Bid {m.yes_bid != null ? `${(m.yes_bid * 100).toFixed(1)}¢` : "—"} ·
                      Ask {m.yes_ask != null ? `${(m.yes_ask * 100).toFixed(1)}¢` : "—"} ·
                      Last {m.last_price != null ? `${(m.last_price * 100).toFixed(1)}¢` : "—"}
                    </div>
                  )}
                </div>
              );
            })}
            {detail.markets.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">No quotes ingested yet. Check back in a minute.</div>
            )}
          </CardContent>
        </Card>

        {eventMoves.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Recent moves on this event (24h, ≥1.5%)</CardTitle></CardHeader>
            <CardContent className="p-0 divide-y divide-border/40">
              {eventMoves.map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <span>{m.contestant_label}</span>
                  <span className={`tabular-nums font-semibold ${m.direction === "up" ? "text-emerald-400" : "text-rose-400"}`}>{fmtPctSigned(m.delta)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {tier !== "elite" && (
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <strong>Elite</strong> ($39/mo) gets live email + SMS the moment Kalshi moves ≥3% in 15 min on any market.{" "}
            <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade →</Link>
          </div>
        )}
      </main>
    </div>
  );
}
