"use client";

import { MARKET_LABELS, MARKET_ORDER } from "@/lib/format";

interface Props {
  active: string;
  available?: Record<string, number>;
  kalshiCounts?: Record<string, number>;
  onSelect: (mt: string) => void;
}

export default function MarketTabs({ active, available = {}, kalshiCounts = {}, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-neutral-800 mb-4">
      {MARKET_ORDER.filter((mt) => MARKET_LABELS[mt]).map((mt) => {
        const total = available[mt] || 0;
        const kalshi = kalshiCounts[mt] || 0;
        const isActive = active === mt;
        const isEmpty = total === 0;
        return (
          <button
            key={mt}
            onClick={() => !isEmpty && onSelect(mt)}
            disabled={isEmpty}
            className={[
              "px-4 py-2 text-sm rounded-t border-b-2 -mb-px transition",
              isActive
                ? "border-green-500 bg-neutral-900 text-green-400"
                : isEmpty
                  ? "border-transparent text-neutral-700 cursor-not-allowed"
                  : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/50",
            ].join(" ")}
          >
            <span className="font-medium">{MARKET_LABELS[mt]}</span>
            {total > 0 && (
              <span className="ml-2 text-xs opacity-70">
                {total}
                {kalshi > 0 && <span className="ml-1 text-amber-400">+K{kalshi}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
