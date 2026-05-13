"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface TournamentInfo {
  tournament: { id: string; name: string; is_major: boolean; kalshi_event_ticker: string | null; start_date: string | null };
  stats: {
    total_markets: number;
    unique_players: number;
    total_matchups: number;
    matchups_by_type: Record<string, number>;
    kalshi_quote_count: number;
    book_quote_count: number;
  };
}

type View = "outrights" | "matchups" | "ladder";

interface Props {
  tournamentId: string;
  activeView: View;
}

export default function TournamentNav({ tournamentId, activeView }: Props) {
  const [info, setInfo] = useState<TournamentInfo | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    fetch(`/api/golfodds/tournament-info?id=${tournamentId}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, [tournamentId]);

  const matchupCount = info?.stats?.total_matchups ?? 0;
  const marketCount = info?.stats?.total_markets ?? 0;

  return (
    <div className="bg-neutral-950/80 border-b border-neutral-800 backdrop-blur sticky top-0 z-20">
      <div className="max-w-[1800px] mx-auto px-6">
        {/* Tournament header */}
        <div className="flex items-baseline gap-3 flex-wrap pt-3 pb-2">
          <Link href="/" className="text-neutral-500 hover:text-neutral-300 text-xs">← All Tournaments</Link>
          <h1 className="text-xl font-bold text-neutral-100">{info?.tournament?.name || "Tournament"}</h1>
          {info?.tournament?.is_major && (
            <span className="text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">Major</span>
          )}
          {info?.tournament?.start_date && (
            <span className="text-xs text-neutral-500">{info.tournament.start_date}</span>
          )}
          {info?.tournament?.kalshi_event_ticker && (
            <span className="text-[10px] text-neutral-600 font-mono">{info.tournament.kalshi_event_ticker}</span>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex items-stretch gap-0">
          <NavTab
            href={`/tournament/?id=${tournamentId}`}
            active={activeView === "outrights"}
            icon="📊"
            label="Outrights & Lines"
            badge={marketCount > 0 ? String(marketCount) : null}
            sublabel="Win · Top 5/10/20 · Make Cut · Round leaders · Props"
          />
          <NavTab
            href={`/matchups/?id=${tournamentId}`}
            active={activeView === "matchups"}
            icon="⚔️"
            label="Matchups"
            badge={matchupCount > 0 ? String(matchupCount) : null}
            sublabel="Head-to-head · 3-ball"
          />
          <NavTab
            href={`/ladder/?id=${tournamentId}`}
            active={activeView === "ladder"}
            icon="🪜"
            label="Ladder"
            badge={null}
            sublabel="Internal consistency check"
          />
        </div>
      </div>
    </div>
  );
}

function NavTab({
  href,
  active,
  icon,
  label,
  badge,
  sublabel,
}: {
  href: string;
  active: boolean;
  icon: string;
  label: string;
  badge: string | null;
  sublabel: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "group flex flex-col px-5 py-2 border-b-2 transition relative -mb-px",
        active
          ? "border-green-500 bg-neutral-900/60 text-green-300"
          : "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900/30",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="text-sm font-semibold">{label}</span>
        {badge && (
          <span
            className={[
              "text-[10px] tabular-nums px-1.5 py-0.5 rounded",
              active ? "bg-green-500/20 text-green-300" : "bg-neutral-800 text-neutral-400 group-hover:bg-neutral-700",
            ].join(" ")}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="text-[10px] text-neutral-500 mt-0.5 pl-7">{sublabel}</div>
    </Link>
  );
}
