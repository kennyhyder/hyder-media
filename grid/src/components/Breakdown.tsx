// Renders a labeled breakdown (e.g. by site type or by ISO) as a sorted list
// with proportional bars.

import { fmtInt } from "@/lib/format";

export interface BreakdownRow {
  label: string;
  count: number;
  href?: string;
}

export default function Breakdown({
  rows,
  title,
}: {
  rows: BreakdownRow[];
  title?: string;
}) {
  const sorted = [...rows].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const max = sorted.length ? sorted[0].count : 1;
  return (
    <div>
      {title && <h3 className="mb-3 text-sm font-semibold text-gray-700">{title}</h3>}
      <ul className="space-y-1.5">
        {sorted.map((r) => (
          <li key={r.label} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-sm text-gray-700">
              {r.href ? (
                <a href={r.href} className="hover:text-purple-700 hover:underline">
                  {r.label}
                </a>
              ) : (
                r.label
              )}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-purple-400"
                style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-gray-600">
              {fmtInt(r.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
