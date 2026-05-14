import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtAmerican, bookLabel } from "@/lib/format";
import type { TotalRow } from "@/lib/sports-data";

interface Props {
  rows: TotalRow[];
  isPaidTier: boolean;
  signupHref?: string;
}

// Totals can have multiple lines per game (e.g. NBA 220.5, 221.5).
// Group by point, then show Over and Under as separate rows. Display
// the consensus point first (where the most books agree), then
// alternates underneath.
export default function TotalsTable({ rows, isPaidTier, signupHref }: Props) {
  if (!rows.length) return null;

  // Group rows by point
  const byPoint = new Map<number, TotalRow[]>();
  for (const r of rows) {
    if (r.point == null) continue;
    const arr = byPoint.get(r.point) || [];
    arr.push(r);
    byPoint.set(r.point, arr);
  }
  // Sort points by how many books are present (consensus first)
  const sortedPoints = Array.from(byPoint.entries())
    .sort(([, a], [, b]) => {
      const aCount = a.reduce((s, r) => s + Object.keys(r.books).length, 0);
      const bCount = b.reduce((s, r) => s + Object.keys(r.books).length, 0);
      return bCount - aCount;
    })
    .map(([p]) => p);

  const allBooks = Array.from(new Set(rows.flatMap((r) => Object.keys(r.books))));
  const MAJOR_FREE = ["draftkings", "fanduel", "betmgm", "caesars", "betrivers"];
  const sortedBooks = allBooks.sort((a, b) => {
    const aMajor = MAJOR_FREE.indexOf(a);
    const bMajor = MAJOR_FREE.indexOf(b);
    if (aMajor !== -1 && bMajor !== -1) return aMajor - bMajor;
    if (aMajor !== -1) return -1;
    if (bMajor !== -1) return 1;
    return a.localeCompare(b);
  });
  const visibleBooks = isPaidTier ? sortedBooks : sortedBooks.filter((b) => MAJOR_FREE.includes(b));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">
          <span className="text-foreground font-semibold">Total</span> · {visibleBooks.length} books · {sortedPoints.length} line{sortedPoints.length === 1 ? "" : "s"}
          {!isPaidTier && visibleBooks.length < sortedBooks.length && (
            <span className="ml-3 text-amber-500 text-xs">
              Free shows {visibleBooks.length} of {sortedBooks.length} books — {signupHref ? <Link href={signupHref} className="underline hover:text-amber-400">sign up free</Link> : <Link href="/pricing" className="underline hover:text-amber-400">upgrade</Link>} for all
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Line</th>
              <th className="px-3 py-2 text-left">Side</th>
              {visibleBooks.map((b) => (
                <th key={b} className="px-2 py-2 text-right whitespace-nowrap">{bookLabel(b)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {sortedPoints.map((point) => {
              const rowsAtPoint = byPoint.get(point)!;
              return rowsAtPoint.map((r, idx) => (
                <tr key={`${point}-${r.side}`} className={idx === 0 ? "" : "border-l border-l-emerald-500/0"}>
                  <td className="px-3 py-2 font-semibold tabular-nums whitespace-nowrap">{idx === 0 ? point : ""}</td>
                  <td className="px-3 py-2 text-sm">{r.side}</td>
                  {visibleBooks.map((b) => {
                    const cell = r.books[b];
                    if (!cell) return <td key={b} className="px-2 py-2 text-right text-muted-foreground/40">—</td>;
                    return (
                      <td key={b} className="px-2 py-2 text-right tabular-nums">{fmtAmerican(cell.american)}</td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
