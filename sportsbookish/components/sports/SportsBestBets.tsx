import Link from "next/link";
import type { SportsRow } from "./SportsBookTable";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel } from "@/lib/format";

interface Props {
  league: string;
  rows: SportsRow[];
}

function MiniCard({ row, league, kind }: { row: SportsRow; league: string; kind: "buy" | "sell" }) {
  const edge = row.edge_vs_books_median;
  const ringCls = kind === "buy" ? "ring-emerald-500/40" : "ring-rose-500/40";
  const edgeCls = kind === "buy" ? "text-emerald-500" : "text-rose-500";
  return (
    <Link href={`/sports/${league}/event/${row.event_id}`} className={`block bg-card border border-border rounded-lg p-3 ring-1 ${ringCls} hover:border-foreground/30`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold truncate">{row.contestant_label}</div>
        <div className={`text-lg font-bold tabular-nums ${edgeCls}`}>{fmtPctSigned(edge)}</div>
      </div>
      <div className="text-[10px] text-muted-foreground truncate mb-2">{row.event_title}</div>
      <div className="grid grid-cols-2 gap-x-2 text-[11px]">
        <div className="text-muted-foreground">Kalshi</div>
        <div className="text-right tabular-nums text-amber-500">{fmtPct(row.implied_prob)}</div>
        <div className="text-muted-foreground">Books med</div>
        <div className="text-right tabular-nums">{fmtPct(row.books_median)}</div>
      </div>
      {row.best_book && (
        <div className="mt-2 pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
          Best book: <span className="text-foreground">{bookLabel(row.best_book.book)}</span>{" "}
          <span className="tabular-nums">{fmtAmerican(row.best_book.american)}</span>
        </div>
      )}
    </Link>
  );
}

export default function SportsBestBets({ league, rows }: Props) {
  const withEdge = rows.filter((r) => r.edge_vs_books_median != null && r.books_count > 0);
  const topBuys = [...withEdge].sort((a, b) => (b.edge_vs_books_median ?? 0) - (a.edge_vs_books_median ?? 0)).slice(0, 5);
  const topSells = [...withEdge].sort((a, b) => (a.edge_vs_books_median ?? 0) - (b.edge_vs_books_median ?? 0)).slice(0, 5);

  if (withEdge.length === 0) return null;

  return (
    <div className="bg-card/50 border border-border rounded-lg p-4 mb-5">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-emerald-500 mb-2 flex items-center gap-2">
            🟢 Top buys
            <span className="text-muted-foreground/70 normal-case font-normal">Kalshi cheaper than books — buy YES</span>
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
            {topBuys.map((r) => <MiniCard key={r.market_id} row={r} league={league} kind="buy" />)}
          </div>
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-rose-500 mb-2 flex items-center gap-2">
            🔴 Most overpriced
            <span className="text-muted-foreground/70 normal-case font-normal">Sell YES on Kalshi, or bet at books</span>
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
            {topSells.map((r) => <MiniCard key={r.market_id} row={r} league={league} kind="sell" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
