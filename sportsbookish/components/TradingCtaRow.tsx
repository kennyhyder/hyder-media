import { affiliateUrl } from "@/lib/affiliates";

// Inline pair of "Trade on Kalshi" / "Trade on Polymarket" CTAs. Use anywhere
// the page is presenting Kalshi/Polymarket prices and the natural next user
// action is to actually act on the edge. Both links go through affiliateUrl()
// so they pick up UTM tracking and (when set) the affiliate-network deep link.
//
// Optional `showPolymarket` / `showKalshi` flags so a Polymarket-only page
// (or Kalshi-only) can pass `false` and render just the relevant side.
//
// Compliance: copy is "Trade", never "Bet" — prediction markets only.

interface Props {
  campaign: string;            // analytics tag (e.g. "tournament-the-memorial")
  showKalshi?: boolean;
  showPolymarket?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export default function TradingCtaRow({
  campaign,
  showKalshi = true,
  showPolymarket = true,
  className = "",
  size = "md",
}: Props) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const kUrl = affiliateUrl("kalshi", { campaign }) || "https://kalshi.com/";
  const pUrl = affiliateUrl("polymarket", { campaign }) || "https://polymarket.com/";
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {showKalshi && (
        <a
          href={kUrl}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className={`inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 transition ${pad} font-semibold text-amber-300`}
          title="Trade on Kalshi (affiliate link)"
        >
          Trade on Kalshi →
        </a>
      )}
      {showPolymarket && (
        <a
          href={pUrl}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className={`inline-flex items-center gap-2 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 transition ${pad} font-semibold text-fuchsia-300`}
          title="Trade on Polymarket (affiliate link)"
        >
          Trade on Polymarket →
        </a>
      )}
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Sponsored{showPolymarket ? " · code SPORTSBOOKISH on Polymarket (iOS)" : ""}
      </span>
    </div>
  );
}
