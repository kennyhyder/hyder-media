"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, edgeTextClass, edgeBgClass } from "@/lib/format";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

interface Row {
  player_id: string;
  player: { id: string; name: string; slug?: string | null } | null;
  kalshi: { implied_prob: number | null } | null;
  datagolf: { dg_prob: number | null } | null;
  books_median: number | null;
  books_min: number | null;
  book_count: number;
  edge_vs_books_median: number | null;
  edge_vs_dg: number | null;
  edge_vs_best_book: number | null;
  best_book_for_bet: { book: string; novig_prob: number; price_american: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null }>;
  user_edge: number | null;
  user_reference: number | null;
}

interface Props {
  tournamentId: string;
  rows: Row[];
  books: string[];
  isPaidTier: boolean;
}

type SortKey =
  | "name"
  | "kalshi"
  | "dg"
  | "books_median"
  | "user_edge"
  | "edge_vs_dg"
  | "edge_vs_best_book"
  | "book_count"
  | `book:${string}`;

function SortHead({ k, current, onClick, children, align = "right" }: { k: SortKey; current: { key: SortKey; desc: boolean }; onClick: (k: SortKey) => void; children: React.ReactNode; align?: "left" | "right" }) {
  const active = current.key === k;
  return (
    <TableHead className={`cursor-pointer select-none hover:bg-muted/30 text-${align}`} onClick={() => onClick(k)}>
      <div className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end w-full" : ""}`}>
        <span>{children}</span>
        {active ? (current.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </div>
    </TableHead>
  );
}

export default function OutrightTable({ tournamentId, rows, books, isPaidTier }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "user_edge", desc: true });

  const toggle = (k: SortKey) => {
    setSort((cur) => (cur.key === k ? { key: k, desc: !cur.desc } : { key: k, desc: true }));
  };

  const sorted = useMemo(() => {
    const v = (r: Row, key: SortKey): number | string | null => {
      if (key === "name") return r.player?.name || "";
      if (key === "kalshi") return r.kalshi?.implied_prob ?? null;
      if (key === "dg") return r.datagolf?.dg_prob ?? null;
      if (key === "books_median") return r.books_median;
      if (key === "user_edge") return r.user_edge;
      if (key === "edge_vs_dg") return r.edge_vs_dg;
      if (key === "edge_vs_best_book") return r.edge_vs_best_book;
      if (key === "book_count") return r.book_count;
      if (key.startsWith("book:")) {
        const b = key.slice(5);
        return r.book_prices[b]?.novig ?? null;
      }
      return null;
    };
    const cmp = (a: Row, b: Row): number => {
      const av = v(a, sort.key);
      const bv = v(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return sort.desc ? bv.localeCompare(av) : av.localeCompare(bv);
      return sort.desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    };
    return [...rows].sort(cmp);
  }, [rows, sort]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead k="name" current={sort} onClick={toggle} align="left">Player</SortHead>
          <SortHead k="kalshi" current={sort} onClick={toggle}><span className="text-amber-500">Kalshi</span></SortHead>
          <SortHead k="dg" current={sort} onClick={toggle}><span className="text-sky-500">DG</span></SortHead>
          <SortHead k="books_median" current={sort} onClick={toggle}>Books med</SortHead>
          <SortHead k="user_edge" current={sort} onClick={toggle}>Buy edge</SortHead>
          <SortHead k="edge_vs_dg" current={sort} onClick={toggle}>vs DG</SortHead>
          <SortHead k="edge_vs_best_book" current={sort} onClick={toggle}>vs best book</SortHead>
          <SortHead k="book_count" current={sort} onClick={toggle}>#</SortHead>
          {books.map((b) => (
            <SortHead key={b} k={`book:${b}` as SortKey} current={sort} onClick={toggle}>
              <span className="text-xs">{bookLabel(b)}</span>
            </SortHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const userEdge = r.user_edge;
          const dgEdge = r.edge_vs_dg;
          const bestEdge = r.edge_vs_best_book;
          return (
            <TableRow key={r.player_id}>
              <TableCell className="font-medium whitespace-nowrap">
                {isPaidTier ? (
                  // Prefer canonical /golf/players/{slug} hub when slug is
                  // available (cross-tournament player profile). Falls back
                  // to legacy tournament-scoped player detail otherwise.
                  r.player?.slug ? (
                    <Link href={`/golf/players/${r.player.slug}`} className="hover:text-emerald-500 hover:underline">
                      {r.player.name}
                    </Link>
                  ) : (
                    <Link href={`/golf/tournament/player?id=${tournamentId}&player_id=${r.player_id}`} className="hover:text-emerald-500 hover:underline">
                      {r.player?.name}
                    </Link>
                  )
                ) : (
                  <span>{r.player?.name}</span>
                )}
                {r.kalshi?.implied_prob != null && <span className="ml-2 text-[10px] text-amber-500/70">●K</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums text-amber-500">{fmtPct(r.kalshi?.implied_prob)}</TableCell>
              <TableCell className="text-right tabular-nums text-sky-500">{fmtPct(r.datagolf?.dg_prob)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtPct(r.books_median)}</TableCell>
              <TableCell className={`text-right tabular-nums ${edgeTextClass(userEdge)} ${edgeBgClass(userEdge)}`}>{fmtPctSigned(userEdge)}</TableCell>
              <TableCell className={`text-right tabular-nums ${edgeTextClass(dgEdge)}`}>{fmtPctSigned(dgEdge)}</TableCell>
              <TableCell className={`text-right tabular-nums ${edgeTextClass(bestEdge)}`}>
                {fmtPctSigned(bestEdge)}
                {r.best_book_for_bet && (
                  <div className="text-[10px] text-muted-foreground">
                    {bookLabel(r.best_book_for_bet.book)} {fmtAmerican(r.best_book_for_bet.price_american)}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{r.book_count}</TableCell>
              {books.map((b) => {
                const px = r.book_prices[b];
                return (
                  <TableCell key={b} className="text-right tabular-nums text-muted-foreground">
                    {px ? (
                      <span title={`american ${fmtAmerican(px.american)}, no-vig ${fmtPct(px.novig)}`}>
                        {fmtPct(px.novig)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
        {sorted.length === 0 && (
          <TableRow>
            <TableCell colSpan={books.length + 8} className="text-center py-8 text-muted-foreground">
              No data for this market type. Kalshi T5/T10/T20 coverage is inconsistent outside majors.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
