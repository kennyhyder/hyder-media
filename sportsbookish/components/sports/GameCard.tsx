import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { fmtPct, fmtPctSigned, edgeTextClass, edgeBgClass } from "@/lib/format";
import type { SportsEventWithMarkets } from "@/lib/sports-data";

interface Props {
  event: SportsEventWithMarkets;
  league: string;
}

export default function GameCard({ event, league }: Props) {
  const startStr = event.start_time
    ? new Date(event.start_time).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  const markets = event.markets || [];
  const anyBooks = markets.some((m) => (m.books_count ?? 0) > 0);

  return (
    <Link href={`/sports/${league}/event/${event.id}`} className="block">
      <Card className="hover:border-emerald-500/40 transition-colors">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="text-sm font-semibold leading-tight truncate flex-1">{event.title}</div>
            {anyBooks && (
              <span className="text-[9px] uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">
                {markets[0]?.books_count}b
              </span>
            )}
          </div>

          {markets.length === 0 && <div className="text-xs text-muted-foreground italic">No markets yet</div>}

          {markets.map((m) => {
            const edge = m.edge_vs_books_median;
            return (
              <div key={m.id} className="flex items-center justify-between text-xs py-1 border-t border-border/40 first:border-0">
                <div className="font-medium truncate flex-1 mr-2">{m.contestant_label}</div>
                <div className="flex items-center gap-2 shrink-0">
                  {m.books_median != null && (
                    <span className="tabular-nums text-muted-foreground" title="Books median">
                      {fmtPct(m.books_median)}
                    </span>
                  )}
                  <span className="tabular-nums text-amber-500 font-semibold w-12 text-right" title="Kalshi">
                    {fmtPct(m.implied_prob)}
                  </span>
                  {edge != null && Math.abs(edge) >= 0.005 && (
                    <span
                      className={`tabular-nums font-semibold text-[10px] px-1 rounded ${edgeTextClass(edge)} ${edgeBgClass(edge)}`}
                      title="Buy edge vs books median"
                    >
                      {fmtPctSigned(edge)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-2">
            <span>{startStr || ""}</span>
            <span className="font-mono">{event.kalshi_event_ticker}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
