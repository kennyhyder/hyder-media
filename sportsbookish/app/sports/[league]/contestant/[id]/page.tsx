import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchContestant } from "@/lib/movements-data";
import { fetchLeagues } from "@/lib/sports-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const EVENT_TYPE_LABEL: Record<string, string> = {
  game: "Game",
  series: "Series",
  championship: "Championship",
  mvp: "MVP",
};

export default async function ContestantPage({ params }: { params: Promise<{ league: string; id: string }> }) {
  const { league, id } = await params;
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect(`/login?next=/sports/${league}/contestant/${id}`);

  const [leagues, data] = await Promise.all([fetchLeagues(), fetchContestant(id)]);
  const meta = leagues.find((l) => l.key === league);
  if (!data || !meta) notFound();

  // Group markets by event_type
  const byType: Record<string, typeof data.markets> = {};
  for (const m of data.markets) {
    const t = m.event.event_type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(m);
  }
  const order = ["championship", "series", "game", "mvp"];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-neutral-500 hover:text-neutral-300">← {meta.display_name}</Link>
          <div className="flex items-center gap-1 font-semibold text-sm">
            <span>{meta.icon}</span>
            <span>{data.contestant.name}</span>
          </div>
          <div className="w-12" />
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <span className="text-4xl">{meta.icon}</span>
            <span>{data.contestant.name}</span>
          </h1>
          <div className="text-sm text-neutral-500 mt-1">{meta.display_name} · {data.markets.length} active markets</div>
        </div>

        {order.map((type) => {
          const list = byType[type];
          if (!list?.length) return null;
          return (
            <section key={type} className="mb-6">
              <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">{EVENT_TYPE_LABEL[type] || type}</h2>
              <div className="space-y-2">
                {list.map((m) => (
                  <Link key={m.market_id} href={`/sports/${league}/event/${m.event.id}`} className="block">
                    <Card className="hover:border-emerald-500/40 transition-colors">
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{m.event.title}</div>
                          {m.event.start_time && <div className="text-xs text-neutral-500 mt-0.5">{new Date(m.event.start_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xl font-bold tabular-nums text-amber-300">{fmtPct(m.implied_prob)}</div>
                          {m.yes_bid != null && m.yes_ask != null && (
                            <div className="text-[10px] text-neutral-500 tabular-nums">{(m.yes_bid * 100).toFixed(0)}¢/{(m.yes_ask * 100).toFixed(0)}¢</div>
                          )}
                        </div>
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
