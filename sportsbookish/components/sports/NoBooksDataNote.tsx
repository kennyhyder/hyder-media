import type { TierKey } from "@/lib/tiers";

const TYPE_LABELS: Record<string, string> = {
  award: "award markets (Coach of the Year, draft picks, etc.)",
  mvp: "MVP voting markets",
  record_best: "best-record season futures",
  record_worst: "worst-record season futures",
  win_total: "season win-total markets",
  trade: "player trade markets",
  series: "playoff series outrights",
  playoffs: "make/miss playoffs markets",
  division: "division winner futures",
  conference: "conference winner futures",
};

// Shared "no sportsbook data for this market type" note. Used by both
// EventView and ContestantView when the underlying market type isn't in
// our current Odds API feed (MVP, win-totals, awards, etc).
//
// Elite-tier users get a "Request data →" mailto link so we can capture
// demand signals for vendor-upgrade prioritization.
export function NoBooksDataNote({ eventType, tier }: { eventType: string; tier: TierKey }) {
  const label = TYPE_LABELS[eventType] || `${eventType.replace(/_/g, " ")} markets`;
  const subject = `Request: ${label} on SportsBookISH`;
  const body =
    `Hi Kenny,\n\n` +
    `I'd like to see sportsbook lines for ${label} on SportsBookISH. ` +
    `Please prioritize sourcing this data.\n\n` +
    `Thanks!`;
  const mailto = `mailto:kenny@hyder.me?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <span className="text-muted-foreground/70">
      Sportsbook lines for {label} are an Elite-tier feature we&apos;re building.
      Books like DraftKings, FanDuel, and BetMGM publish these on their own sites;
      our current data feed doesn&apos;t include them yet — we&apos;re evaluating
      premium feeds to add them. Kalshi is the live signal here for now.
      {tier === "elite" && (
        <>
          {" "}
          <a
            href={mailto}
            className="text-emerald-400 hover:underline font-medium"
          >
            Request data →
          </a>
        </>
      )}
    </span>
  );
}
