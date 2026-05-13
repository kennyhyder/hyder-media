import Link from "next/link";
import { LineChart } from "lucide-react";

interface Props {
  variant?: "anonymous" | "free";
  next?: string;
  className?: string;
}

// Top-of-page CTA strip shown to anonymous visitors (and optionally free users)
// to drive signup → upgrade. Soft, single line, dismissible later via cookie.
export default function UpsellBanner({ variant = "anonymous", next, className }: Props) {
  const href = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  if (variant === "free") {
    return (
      <div className={`border-b border-amber-500/30 bg-amber-500/5 ${className || ""}`}>
        <div className="container mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm">
          <span className="text-muted-foreground">
            <strong className="text-foreground">You&apos;re on First Line (free).</strong> Unlock per-book pricing, Top-5/10/20, props, matchups, and live alerts.
          </span>
          <Link
            href="/pricing"
            className="shrink-0 inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 font-semibold"
          >
            Upgrade →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`border-b border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-amber-500/10 ${className || ""}`}>
      <div className="container mx-auto max-w-6xl px-4 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm">
        <span className="text-foreground inline-flex items-center gap-2">
          <LineChart className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span><strong>Free</strong> &middot; save favorites, get the top edges emailed daily, set custom alerts (Elite).</span>
        </span>
        <Link
          href={href}
          className="shrink-0 inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 font-semibold"
        >
          Sign up free →
        </Link>
      </div>
    </div>
  );
}
