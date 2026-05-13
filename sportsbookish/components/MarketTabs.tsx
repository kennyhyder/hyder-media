import Link from "next/link";
import { Lock } from "lucide-react";
import { MARKET_LABELS, MARKET_GROUPS } from "@/lib/format";

interface Props {
  tournamentId: string;
  active: string;
  available?: Record<string, number>;
  kalshiCounts?: Record<string, number>;
  isFreeTier: boolean;
}

export default function MarketTabs({ tournamentId, active, available = {}, kalshiCounts = {}, isFreeTier }: Props) {
  return (
    <div className="border-b border-border/40 mb-4 space-y-1 pb-1">
      {MARKET_GROUPS.map((group) => {
        const visible = group.types.filter((mt) => MARKET_LABELS[mt] && (available[mt] || 0) > 0);
        if (visible.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 w-24 shrink-0">
              {group.label}
            </span>
            {visible.map((mt) => {
              const total = available[mt] || 0;
              const kalshi = kalshiCounts[mt] || 0;
              const isActive = active === mt;
              // Free tier: only Win is unlocked; everything else shows lock + upsell
              const locked = isFreeTier && mt !== "win";
              return (
                <Link
                  key={mt}
                  href={locked ? "/pricing" : `/golf/tournament?id=${tournamentId}&mt=${mt}`}
                  className={[
                    "px-3 py-1 text-xs rounded transition flex items-center gap-1",
                    isActive
                      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                      : locked
                        ? "text-muted-foreground/60 hover:text-muted-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  ].join(" ")}
                  title={locked ? "Pro+ feature" : `${total} markets${kalshi ? `, ${kalshi} with Kalshi` : ""}`}
                >
                  {locked && <Lock className="h-3 w-3 text-amber-400/70" />}
                  <span className="font-medium">{MARKET_LABELS[mt]}</span>
                  <span className="ml-1 text-[10px] opacity-70">{total}</span>
                  {kalshi > 0 && <span className="ml-0.5 text-[10px] text-amber-400">K{kalshi}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
