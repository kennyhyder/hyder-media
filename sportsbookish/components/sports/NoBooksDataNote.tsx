import type { TierKey } from "@/lib/tiers";

const TYPE_LABELS: Record<string, string> = {
  award: "award markets",
  mvp: "MVP markets",
  record_best: "best-record futures",
  record_worst: "worst-record futures",
  win_total: "win-total markets",
  trade: "trade markets",
  series: "series outrights",
  playoffs: "playoffs markets",
  division: "division futures",
  conference: "conference futures",
};

// Short CTA shown when a market type isn't in our books index.
// Elite → mailto to capture demand signal directly.
// Free/Pro → upgrade link.
export function NoBooksDataNote({ eventType, tier }: { eventType: string; tier: TierKey }) {
  const label = TYPE_LABELS[eventType] || `${eventType.replace(/_/g, " ")} markets`;

  if (tier === "elite") {
    const subject = `Request: ${label} on SportsBookISH`;
    const body =
      `Hi Kenny,\n\n` +
      `I'd like sportsbook lines added for ${label}.\n\n` +
      `Thanks!`;
    const mailto = `mailto:kenny@hyder.me?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return (
      <a href={mailto} className="text-emerald-400 hover:underline font-medium">
        Request sportsbook coverage →
      </a>
    );
  }

  return (
    <a href="/pricing" className="text-emerald-400 hover:underline font-medium">
      Sportsbook coverage — sign up for Elite to request →
    </a>
  );
}
