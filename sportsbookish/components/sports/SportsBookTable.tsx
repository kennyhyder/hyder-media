"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, edgeTextClass, edgeBgClass } from "@/lib/format";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export interface SportsRow {
  event_id: string;
  event_title: string;
  start_time: string | null;
  market_id: string;
  contestant_label: string;
  implied_prob: number | null;
  books_count: number;
  books_median: number | null;
  edge_vs_books_median: number | null;
  edge_vs_best_book: number | null;
  best_book: { book: string; implied_prob_novig: number | null; american: number | null } | null;
  book_prices: Record<string, { american: number | null; novig: number | null }>;
}

interface Props {
  league: string;
  rows: SportsRow[];
  books: string[];
  isPaidTier: boolean;
}

type SortKey =
  | "matchup" | "kalshi" | "books_median" | "edge_vs_books_median"
  | "edge_vs_best_book" | "book_count" | "start_time"
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

export default function SportsBookTable({ league, rows, books, isPaidTier }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "edge_vs_books_median", desc: true });
  const [filter, setFilter] = useState<"all" | "books_only">("books_only");

  const toggle = (k: SortKey) => {
    setSort((cur) => (cur.key === k ? { key: k, desc: !cur.desc } : { key: k, desc: true }));
  };

  const filtered = useMemo(() => {
    if (filter === "books_only") return rows.filter((r) => r.books_count > 0);
    return rows;
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const v = (r: SportsRow, key: SortKey): number | string | null => {
      if (key === "matchup") return r.event_title || "";
      if (key === "start_time") return r.start_time ? new Date(r.start_time).getTime() : null;
      if (key === "kalshi") return r.implied_prob;
      if (key === "books_median") return r.books_median;
      if (key === "edge_vs_books_median") return r.edge_vs_books_median;
      if (key === "edge_vs_best_book") return r.edge_vs_best_book;
      if (key === "book_count") return r.books_count;
      if (key.startsWith("book:")) {
        const b = key.slice(5);
        return r.book_prices[b]?.novig ?? null;
      }
      return null;
    };
    return [...filtered].sort((a, b) => {
      const av = v(a, sort.key);
      const bv = v(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return sort.desc ? bv.localeCompare(av) : av.localeCompare(bv);
      return sort.desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [filtered, sort]);

  const visibleBooks = isPaidTier ? books : books.filter((b) => ["draftkings", "fanduel", "betmgm", "caesars", "betrivers"].includes(b));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Filter:</span>
        <button onClick={() => setFilter("books_only")} className={`px-2 py-1 rounded ${filter === "books_only" ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:bg-muted/50"}`}>With books only ({rows.filter((r) => r.books_count > 0).length})</button>
        <button onClick={() => setFilter("all")} className={`px-2 py-1 rounded ${filter === "all" ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:bg-muted/50"}`}>All games ({rows.length})</button>
        <span className="ml-auto text-muted-foreground/70">Click any column to sort. {sorted.length} rows.</span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="matchup" current={sort} onClick={toggle} align="left">Team / Game</SortHead>
              <SortHead k="kalshi" current={sort} onClick={toggle}><span className="text-amber-500">Kalshi</span></SortHead>
              <SortHead k="books_median" current={sort} onClick={toggle}>Books med</SortHead>
              <SortHead k="edge_vs_books_median" current={sort} onClick={toggle}>Buy edge</SortHead>
              <SortHead k="edge_vs_best_book" current={sort} onClick={toggle}>vs best</SortHead>
              <SortHead k="book_count" current={sort} onClick={toggle}>#</SortHead>
              <SortHead k="start_time" current={sort} onClick={toggle}>Start</SortHead>
              {visibleBooks.map((b) => (
                <SortHead key={b} k={`book:${b}` as SortKey} current={sort} onClick={toggle}>
                  <span className="text-xs">{bookLabel(b)}</span>
                </SortHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const edgeMed = r.edge_vs_books_median;
              const edgeBest = r.edge_vs_best_book;
              return (
                <TableRow key={r.market_id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/sports/${league}/event/${r.event_id}`} className="hover:underline">
                      <div className="font-medium">{r.contestant_label}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[16ch]">{r.event_title}</div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-amber-500">{fmtPct(r.implied_prob)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(r.books_median)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${edgeTextClass(edgeMed)} ${edgeBgClass(edgeMed)}`}>{fmtPctSigned(edgeMed)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${edgeTextClass(edgeBest)}`}>
                    {fmtPctSigned(edgeBest)}
                    {r.best_book && (
                      <div className="text-[10px] text-muted-foreground">
                        {bookLabel(r.best_book.book)} {fmtAmerican(r.best_book.american)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground text-xs">{r.books_count}</TableCell>
                  <TableCell className="text-right text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {r.start_time ? new Date(r.start_time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—"}
                  </TableCell>
                  {visibleBooks.map((b) => {
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
                <TableCell colSpan={visibleBooks.length + 7} className="text-center py-8 text-muted-foreground">
                  No rows in current filter. Try switching to &quot;All games&quot; or check back when books post lines (1-2 days before tipoff).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
