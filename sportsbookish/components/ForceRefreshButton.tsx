"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Zap, Lock } from "lucide-react";

// Source determines which endpoint we hit + which entity id we pass.
//   "sports" — POSTs to /api/sports/refresh with event_id    (3 credits / call)
//   "golf"   — POSTs to /api/golf/refresh   with tournament_id (free, rate-limited)
type RefreshSource = "sports" | "golf";

interface Props {
  // ID of the thing to refresh — sports event UUID or golf tournament UUID
  entityId: string;
  // Display label suffix ("event" vs "tournament") + endpoint routing
  source: RefreshSource;
  // For sports: which league this belongs to (passed through to the API for logging)
  league?: string;
  tier: "free" | "pro" | "elite";
  isAnonymous: boolean;
}

interface Quota {
  remaining: number;
  used_today: number;
  daily_quota: number;
  cooldown_until: string | null;
}

const ENDPOINT: Record<RefreshSource, string> = {
  sports: "/api/sports/refresh",
  golf: "/api/golf/refresh",
};
const QUERY_PARAM: Record<RefreshSource, string> = {
  sports: "event_id",
  golf: "tournament_id",
};

export default function ForceRefreshButton({ entityId, source, league, tier, isAnonymous }: Props) {
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (tier !== "elite") return;
    let alive = true;
    fetch(`${ENDPOINT[source]}?${QUERY_PARAM[source]}=${entityId}`)
      .then((r) => r.json())
      .then((data) => { if (alive && data.daily_quota) setQuota(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tier, entityId, source]);

  if (tier !== "elite") {
    return (
      <Link
        href={isAnonymous ? "/signup?next=/pricing" : "/pricing"}
        className="inline-flex items-center gap-1.5 text-xs rounded border border-amber-500/40 bg-amber-500/5 text-amber-500 hover:bg-amber-500/10 px-3 py-1.5"
        title={`Force-refresh ${source === "golf" ? "tournament" : "event"} odds — Elite only`}
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        Force refresh (Elite)
      </Link>
    );
  }

  const cooling = quota?.cooldown_until ? new Date(quota.cooldown_until).getTime() > Date.now() : false;
  const out = (quota?.remaining ?? 1) <= 0;
  const disabled = busy || cooling || out;

  async function refresh() {
    setBusy(true);
    try {
      const payload = source === "golf"
        ? { tournament_id: entityId }
        : { event_id: entityId, league };
      const r = await fetch(ENDPOINT[source], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(data.error || "Refresh failed");
        if (data.daily_quota) setQuota(data);
        return;
      }
      const msg = source === "golf"
        ? `✓ Fresh Kalshi + DataGolf data · ${data.remaining} refreshes left today`
        : `✓ ${data.quotes_inserted} fresh quotes · ${data.remaining} refreshes left today`;
      toast.success(msg);
      const cooldownSec = source === "golf" ? 90 : 5 * 60;
      setQuota({
        remaining: data.remaining,
        used_today: data.used_today,
        daily_quota: data.daily_quota,
        cooldown_until: new Date(Date.now() + cooldownSec * 1000).toISOString(),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  let label = busy ? "Refreshing…" : "Force refresh";
  let title = source === "golf"
    ? "Re-pull Kalshi + DataGolf for this tournament right now"
    : "Re-pull Kalshi (always) + sportsbook lines (for game events) right now";
  if (out) { label = "Daily limit hit"; title = "Resets at midnight UTC"; }
  else if (cooling) {
    const secs = Math.ceil((new Date(quota!.cooldown_until!).getTime() - Date.now()) / 1000);
    label = `Wait ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    title = "On cooldown — wait a moment";
  }

  return (
    <Button
      onClick={refresh}
      disabled={disabled}
      size="sm"
      variant="outline"
      title={title}
      className="border-emerald-500/40 hover:border-emerald-500 hover:bg-emerald-500/10"
    >
      {busy ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : <Zap className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />}
      {label}
      {!out && !cooling && quota && (
        <span className="ml-2 text-[10px] text-muted-foreground">{quota.remaining}/{quota.daily_quota}</span>
      )}
    </Button>
  );
}
