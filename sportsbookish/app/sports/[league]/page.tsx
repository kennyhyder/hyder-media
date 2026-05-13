import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchLeagues, fetchEventsByLeague } from "@/lib/sports-data";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

const EVENT_TYPE_LABEL: Record<string, string> = {
  game: "Game",
  series: "Series",
  championship: "Championship",
  mvp: "MVP",
};

export default async function LeaguePage({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  const { userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/sports/${league}`);

  const leagues = await fetchLeagues();
  const meta = leagues.find((l) => l.key === league);
  if (!meta) notFound();

  const events = await fetchEventsByLeague(league);

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
        {events.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No open events for {meta.display_name} right now. Check back during the season.
          </div>
        )}

        {order.map((type) => {
          const list = groups[type];
          if (!list?.length) return null;
          return (
            <section key={type} className="mb-8">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{EVENT_TYPE_LABEL[type] || type} ({list.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((e) => (
                  <Link key={e.id} href={`/sports/${league}/event/${e.id}`} className="block">
                    <Card className="hover:border-emerald-500/40 transition-colors">
                      <CardContent className="p-4">
                        <div className="text-sm font-semibold leading-tight">{e.title}</div>
                        {e.start_time && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(e.start_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-2 font-mono">{e.kalshi_event_ticker}</div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
