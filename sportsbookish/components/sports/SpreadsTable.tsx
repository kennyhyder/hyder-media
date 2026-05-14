import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtAmerican, bookLabel } from "@/lib/format";
import type { SpreadRow } from "@/lib/sports-data";

interface Props {
  rows: SpreadRow[];
  isPaidTier: boolean;
  signupHref?: string;
}

export default function SpreadsTable({ rows, isPaidTier, signupHref }: Props) {
  if (!rows.length) return null;

  // Build union of book keys across both rows, sorted by major US books first
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

  // Find consensus spread = median of all books' favourite team points
  const fav = rows.find((r) => Object.values(r.books).some((v) => v.point != null && v.point < 0));
  const consensus = fav ? medianPoint(Object.values(fav.books).map((v) => v.point).filter((v): v is number => v != null)) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">
          <span className="text-foreground font-semibold">Spread</span> · {visibleBooks.length} books
          {consensus != null && <span className="ml-3">Consensus line: <span className="text-foreground font-semibold tabular-nums">{consensus > 0 ? `+${consensus}` : consensus}</span></span>}
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
              <th className="px-3 py-2 text-left">Team</th>
              {visibleBooks.map((b) => (
                <th key={b} className="px-2 py-2 text-right whitespace-nowrap">{bookLabel(b)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-3 py-2 font-medium whitespace-nowrap">{r.label}</td>
                {visibleBooks.map((b) => {
                  const cell = r.books[b];
                  if (!cell) return <td key={b} className="px-2 py-2 text-right text-muted-foreground/40">—</td>;
                  return (
                    <td key={b} className="px-2 py-2 text-right tabular-nums">
                      <div className="font-semibold">{cell.point != null ? (cell.point > 0 ? `+${cell.point}` : cell.point) : "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtAmerican(cell.american)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function medianPoint(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
