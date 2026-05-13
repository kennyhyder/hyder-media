"use client";

import { MARKET_LABELS, MARKET_GROUPS } from "@/lib/format";

interface Props {
  active: string;
  available?: Record<string, number>;
  kalshiCounts?: Record<string, number>;
  onSelect: (mt: string) => void;
}

export default function MarketTabs({ active, available = {}, kalshiCounts = {}, onSelect }: Props) {
  return (
    <div className="border-b border-neutral-800 mb-4 space-y-1 pb-1">
      {MARKET_GROUPS.map((group) => {
        // Only render the group if at least one market type in it has data
        const visible = group.types.filter((mt) => MARKET_LABELS[mt] && (available[mt] || 0) > 0);
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-600 w-24 shrink-0">{group.label}</span>
            {visible.map((mt) => {
              const total = available[mt] || 0;
              const kalshi = kalshiCounts[mt] || 0;
              const isActive = active === mt;
              return (
                <button
                  key={mt}
                  onClick={() => onSelect(mt)}
                  className={[
                    "px-3 py-1 text-xs rounded transition",
                    isActive
                      ? "bg-green-500/20 text-green-300 ring-1 ring-green-500/40"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/70",
                  ].join(" ")}
                  title={`${total} markets${kalshi ? `, ${kalshi} with Kalshi` : ""}`}
                >
                  <span className="font-medium">{MARKET_LABELS[mt]}</span>
                  <span className="ml-1.5 text-[10px] opacity-70">{total}</span>
                  {kalshi > 0 && <span className="ml-1 text-[10px] text-amber-400">K{kalshi}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
