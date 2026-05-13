import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchEventDetail, fetchLeagues } from "@/lib/sports-data";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await params;
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/sports/${league}/event/${id}`);

  const [leagues, detail] = await Promise.all([
    fetchLeagues(),
    fetchEventDetail(id),
  ]);
  const meta = leagues.find((l) => l.key === league);
  if (!detail || !meta) notFound();

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground">← {meta.display_name}</Link>
          <div className="text-sm font-semibold">{detail.event.event_type}</div>
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

        <Card>
          <CardHeader>
            <CardTitle>Kalshi prices</CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {detail.markets.map((m) => {
              const p = m.implied_prob;
              const width = Math.max(0, Math.min(100, (p ?? 0) * 100));
              return (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{m.contestant_label}</div>
                    <div className="text-2xl font-bold tabular-nums text-amber-300">{p != null ? `${(p * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
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

        {tier !== "elite" && (
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <strong>Elite</strong> ($39/mo) gets live email + SMS alerts whenever Kalshi moves ≥3% in 15 min — perfect for in-play games.{" "}
            <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade →</Link>
          </div>
        )}
      </main>
    </div>
  );
}
