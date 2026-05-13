"use client";

import { fmtPct } from "@/lib/format";

export function ProbCell({ p, sub, tone = "neutral" }: { p: number | null | undefined; sub?: string | null; tone?: "kalshi" | "dg" | "book" | "neutral" }) {
  const toneCls =
    tone === "kalshi"
      ? "text-amber-300"
      : tone === "dg"
        ? "text-sky-300"
        : tone === "book"
          ? "text-neutral-300"
          : "text-neutral-300";
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`tabular-nums ${toneCls}`}>{fmtPct(p)}</span>
      {sub && <span className="text-[10px] text-neutral-500 tabular-nums">{sub}</span>}
    </span>
  );
}
