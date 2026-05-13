import Link from "next/link";
import { Lock } from "lucide-react";

interface Props {
  tournamentId: string;
  active: "outrights" | "matchups" | "player";
  matchupCount?: number;
  marketCount?: number;
  proRequired: boolean;
}

export default function TournamentTabs({ tournamentId, active, matchupCount, marketCount, proRequired }: Props) {
  const tabs = [
    { key: "outrights" as const, label: "Outrights & Lines", href: `/golf/tournament?id=${tournamentId}`, count: marketCount, locked: false },
    { key: "matchups" as const,  label: "Matchups",          href: `/golf/tournament/matchups?id=${tournamentId}`, count: matchupCount, locked: proRequired },
  ];
  return (
    <div className="flex gap-1 border-b border-border/40 mb-5">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.locked ? "/pricing" : t.href}
            className={[
              "px-4 py-2 text-sm border-b-2 -mb-px transition flex items-center gap-1",
              isActive ? "border-emerald-500 text-emerald-300" : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.locked && <Lock className="h-3 w-3 text-amber-400" />}
            <span>{t.label}</span>
            {t.count != null && <span className="text-xs opacity-60 ml-1">{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
