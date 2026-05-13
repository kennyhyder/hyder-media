import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { fetchLeagues, fetchEventsByLeagueWithMarkets } from "@/lib/sports-data";
import { fetchMovements } from "@/lib/movements-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { fmtPctSigned } from "@/lib/format";
import GameCard from "@/components/sports/GameCard";

export const dynamic = "force-dynamic";

const EVENT_TYPE_LABEL: Record<string, string> = {
  game: "Game",
  series: "Series",
  championship: "Championship",
  mvp: "MVP",
};

// Free tier sees only "game" type events. Pro+ sees series, championship, mvp.
function visibleEventTypesForTier(tier: string): string[] {
  if (tier === "free") return ["game"];
  return ["championship", "series", "game", "mvp"];
}

export default async function LeaguePage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/sports/${league}`);

  const [leagues, events, leagueMoves] = await Promise.all([
    fetchLeagues(),
    fetchEventsByLeagueWithMarkets(league),
    fetchMovements({ sinceHours: 24, league, minDelta: 0.02, limit: 6 }),
  ]);
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();
  const allowedTypes = visibleEventTypesForTier(tier);

  // Group by event_type
  const groups: Record<string, typeof events> = {};
  for (const e of events) {
    if (!groups[e.event_type]) groups[e.event_type] = [];
    groups[e.event_type].push(e);
  }

  const order = ["championship", "series", "game", "mvp"];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground">← Sports</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{meta.icon}</span>
            <span>{meta.display_name}</span>
          </div>
          <div className="w-12" />
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-8">
        {leagueMoves.length > 0 && (
          <section className="mb-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">📈 Recent moves (24h)</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {leagueMoves.map((m) => (
                <Link key={m.id} href={`/sports/${league}/event/${m.event_id}`} className={`block rounded border p-2 text-xs hover:bg-muted/30 ${m.direction === "up" ? "border-emerald-500/30" : "border-rose-500/30"}`}>
                  <div className="font-medium truncate">{m.contestant_label}</div>
                  <div className={`text-sm tabular-nums font-bold ${m.direction === "up" ? "text-emerald-400" : "text-rose-400"}`}>{fmtPctSigned(m.delta)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{m.event_title}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {events.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No open events for {meta.display_name} right now. Check back during the season.
          </div>
        )}

        {order.map((type) => {
          const list = groups[type];
          if (!list?.length) return null;
          const locked = !allowedTypes.includes(type);
          return (
            <section key={type} className="mb-8">
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{EVENT_TYPE_LABEL[type] || type} ({list.length})</h2>
                {locked && <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15 text-[10px]"><Lock className="h-2.5 w-2.5 mr-1" />Pro</Badge>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((e) => {
                  if (locked) {
                    return (
                      <Link key={e.id} href="/pricing" className="block">
                        <Card className="opacity-50 hover:opacity-80 transition-opacity">
                          <CardContent className="p-4 relative">
                            <div className="text-sm font-semibold leading-tight blur-sm">{e.title}</div>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20"><Lock className="h-3 w-3 mr-1" />Pro</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  }
                  return <GameCard key={e.id} event={e} league={league} />;
                })}
              </div>
            </section>
          );
        })}

        {tier === "free" && (
          <div className="mt-8 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            Free tier sees individual games only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro ($19/mo)</Link> to unlock series winners, championship futures, MVP odds, and team detail pages.
          </div>
        )}
      </main>
    </div>
  );
}
