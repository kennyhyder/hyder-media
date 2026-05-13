import Link from "next/link";
import type { SportsRow } from "./SportsBookTable";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel } from "@/lib/format";

interface Props {
  league: string;
  rows: SportsRow[];
}

function MiniCard({ row, league, kind }: { row: SportsRow; league: string; kind: "buy" | "sell" }) {
  const edge = row.edge_vs_books_median;
  const ringCls = kind === "buy" ? "ring-emerald-500/50" : "ring-rose-500/50";
  const edgeCls = kind === "buy" ? "text-emerald-500" : "text-rose-500";
  const action = kind === "buy" ? "BUY" : "SELL";
  const actionBg = kind === "buy" ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500";
  return (
    <Link href={`/sports/${league}/event/${row.event_id}`} className={`block bg-card border border-border rounded-lg p-3 ring-1 ${ringCls} hover:border-foreground/30 transition`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold truncate" title={row.contestant_label}>{row.contestant_label}</div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${actionBg}`}>{action}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${edgeCls} mb-2`}>{fmtPctSigned(edge)}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Edge vs books median</div>
      <div className="grid grid-cols-2 gap-x-2 text-[11px] mb-2">
        <div className="text-muted-foreground">Kalshi</div>
        <div className="text-right tabular-nums text-amber-500">{fmtPct(row.implied_prob)}</div>
        <div className="text-muted-foreground">Books med</div>
        <div className="text-right tabular-nums">{fmtPct(row.books_median)}</div>
      </div>
      {row.best_book && (
        <div className="pt-2 border-t border-border/60 text-[11px] text-muted-foreground">
          Best: <span className="text-foreground">{bookLabel(row.best_book.book)}</span>{" "}
          <span className="tabular-nums">{fmtAmerican(row.best_book.american)}</span>
        </div>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground/70 truncate">{row.event_title}</div>
    </Link>
  );
}

export default function SportsBestBets({ league, rows }: Props) {
  const withEdge = rows.filter((r) => r.edge_vs_books_median != null && r.books_count > 0);
  const topBuys = [...withEdge].sort((a, b) => (b.edge_vs_books_median ?? 0) - (a.edge_vs_books_median ?? 0)).slice(0, 3);
  const topSells = [...withEdge].sort((a, b) => (a.edge_vs_books_median ?? 0) - (b.edge_vs_books_median ?? 0)).slice(0, 3);

  if (withEdge.length === 0) return null;

  return (
    <div className="mb-5 space-y-4">
      {topBuys.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-emerald-500 mb-2 flex items-center gap-2">
            <span className="text-base">🟢</span>
            Top buys
            <span className="text-muted-foreground/70 normal-case font-normal">Kalshi cheaper than books — buy YES on Kalshi</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topBuys.map((r) => <MiniCard key={r.market_id} row={r} league={league} kind="buy" />)}
          </div>
        </div>
      )}
      {topSells.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-rose-500 mb-2 flex items-center gap-2">
            <span className="text-base">🔴</span>
            Most overpriced on Kalshi
            <span className="text-muted-foreground/70 normal-case font-normal">Sell YES on Kalshi, or bet at the books instead</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topSells.map((r) => <MiniCard key={r.market_id} row={r} league={league} kind="sell" />)}
          </div>
        </div>
      )}
    </div>
  );
}
