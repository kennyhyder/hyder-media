"use client";

import Link from "next/link";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, MARKET_LABELS } from "@/lib/format";

interface PlayerRow {
  player_id: string;
  player: { id: string; name: string };
  kalshi: { implied_prob: number | null; yes_bid: number | null; yes_ask: number | null } | null;
  datagolf: { dg_prob: number | null } | null;
  books_median: number | null;
  book_count: number;
  best_book_for_bet: { book: string; novig_prob: number; price_american: number | null } | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  edge_vs_dg: number | null;
}

interface Props {
  players: PlayerRow[];
  marketType: string;
  tournamentId?: string;
  minBooks?: number;
  minEdge?: number;
}

// Pick the top N rows by signed edge (positive = best buys), filtering for
// reliability (minimum book coverage, minimum |edge|, and a non-trivial kalshi
// price so we don't surface ghost markets).
function topByEdge(players: PlayerRow[], n: number, direction: "buy" | "sell", minBooks: number, minEdge: number) {
  const rows = players
    .filter(
      (r) =>
        r.kalshi?.implied_prob != null &&
        r.kalshi.implied_prob > 0.001 &&
        r.edge_vs_books_median != null &&
        r.book_count >= minBooks &&
        Math.abs(r.edge_vs_books_median) >= minEdge
    )
    .slice();
  rows.sort((a, b) =>
    direction === "buy"
      ? (b.edge_vs_books_median ?? -Infinity) - (a.edge_vs_books_median ?? -Infinity)
      : (a.edge_vs_books_median ?? Infinity) - (b.edge_vs_books_median ?? Infinity)
  );
  if (direction === "buy") return rows.filter((r) => (r.edge_vs_books_median ?? 0) > 0).slice(0, n);
  return rows.filter((r) => (r.edge_vs_books_median ?? 0) < 0).slice(0, n);
}

function Card({ row, direction, tournamentId }: { row: PlayerRow; direction: "buy" | "sell"; tournamentId?: string }) {
  const edge = row.edge_vs_books_median!;
  const edgePct = edge * 100;
  const isBuy = direction === "buy";
  const accent = isBuy ? "emerald" : "rose";
  // Tailwind doesn't safely interpolate dynamic classes, so spell them out
  const ringCls = isBuy ? "ring-emerald-500/30" : "ring-rose-500/30";
  const badgeBg = isBuy ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30";
  const labelCls = isBuy ? "text-emerald-400" : "text-rose-400";
  return (
    <div className={`bg-neutral-900 border border-neutral-800 rounded-lg p-3 ring-1 ${ringCls}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        {tournamentId ? (
          <Link
            href={`/player/?id=${row.player_id}&tournament_id=${tournamentId}`}
            className="text-sm font-semibold text-neutral-100 hover:text-green-400 hover:underline truncate"
            title={row.player?.name}
          >
            {row.player?.name}
          </Link>
        ) : (
          <div className="text-sm font-semibold text-neutral-100 truncate" title={row.player?.name}>
            {row.player?.name}
          </div>
        )}
        <div className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded border ${badgeBg}`}>
          {isBuy ? "BUY" : "SELL"}
        </div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${labelCls}`}>{fmtPctSigned(edge)}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-2">
        edge vs book median ({row.book_count}{` book${row.book_count === 1 ? "" : "s"}`})
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <div className="text-neutral-500">Kalshi</div>
        <div className="text-right tabular-nums text-amber-300">{fmtPct(row.kalshi?.implied_prob)}</div>
        <div className="text-neutral-500">Books med</div>
        <div className="text-right tabular-nums text-neutral-300">{fmtPct(row.books_median)}</div>
        <div className="text-neutral-500">DG model</div>
        <div className="text-right tabular-nums text-sky-300">{fmtPct(row.datagolf?.dg_prob)}</div>
      </div>
      {row.best_book_for_bet && (
        <div className="mt-2 pt-2 border-t border-neutral-800 text-[11px] text-neutral-400">
          {isBuy ? "Cheapest book: " : "Best alt: "}
          <span className="text-neutral-200">{bookLabel(row.best_book_for_bet.book)}</span>{" "}
          <span className="tabular-nums text-neutral-300">{fmtAmerican(row.best_book_for_bet.price_american)}</span>
          {row.edge_vs_best_book != null && (
            <span className={`ml-1 tabular-nums ${row.edge_vs_best_book > 0 ? "text-emerald-300" : "text-rose-300"}`}>
              ({fmtPctSigned(row.edge_vs_best_book)} vs Kalshi)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function BestBetsCards({ players, marketType, tournamentId, minBooks = 3, minEdge = 0.002 }: Props) {
  const buys = topByEdge(players, 5, "buy", minBooks, minEdge);
  const sells = topByEdge(players, 3, "sell", minBooks, minEdge);
  const label = MARKET_LABELS[marketType] || marketType;

  if (buys.length === 0 && sells.length === 0) {
    return (
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-4 mb-5 text-sm text-neutral-500">
        No actionable mispricings on the {label} market yet — Kalshi and books are within 0.2% across the field
        {minBooks > 1 ? ` (filtered to markets with ${minBooks}+ books)` : ""}.
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-3">
      {buys.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold text-emerald-400">★ Top buy opportunities</span>
            <span className="text-xs text-neutral-500">Kalshi cheaper than fair — buy YES</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {buys.map((r) => <Card key={r.player_id} row={r} direction="buy" tournamentId={tournamentId} />)}
          </div>
        </div>
      )}
      {sells.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold text-rose-400">▼ Most overpriced on Kalshi</span>
            <span className="text-xs text-neutral-500">Sell YES on Kalshi, or bet at the books instead</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {sells.map((r) => <Card key={r.player_id} row={r} direction="sell" tournamentId={tournamentId} />)}
          </div>
        </div>
      )}
    </div>
  );
}
