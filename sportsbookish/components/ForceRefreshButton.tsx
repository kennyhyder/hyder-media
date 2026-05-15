"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, Zap, Lock } from "lucide-react";

interface Props {
  eventId: string;
  league: string;
  tier: "free" | "pro" | "elite";
  isAnonymous: boolean;
}

interface Quota {
  remaining: number;
  used_today: number;
  daily_quota: number;
  cooldown_until: string | null;
}

// Elite-only "force refresh" button. Daily quota + per-event cooldown
// enforced server-side. Anonymous + Free + Pro see an upsell badge.
export default function ForceRefreshButton({ eventId, league, tier, isAnonymous }: Props) {
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (tier !== "elite") return;
    let alive = true;
    fetch(`/api/sports/refresh?event_id=${eventId}`).then((r) => r.json()).then((data) => {
      if (alive && data.daily_quota) setQuota(data);
    }).catch(() => {});
    return () => { alive = false; };
  }, [tier, eventId]);

  if (tier !== "elite") {
    return (
      <Link
        href={isAnonymous ? "/signup?next=/pricing" : "/pricing"}
        className="inline-flex items-center gap-1.5 text-xs rounded border border-amber-500/40 bg-amber-500/5 text-amber-500 hover:bg-amber-500/10 px-3 py-1.5"
        title="Force-refresh book lines — Elite only"
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
      const r = await fetch(`/api/sports/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, league }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(data.error || "Refresh failed");
        if (data.daily_quota) setQuota(data);
        return;
      }
      toast.success(`✓ ${data.quotes_inserted} fresh quotes · ${data.remaining} refreshes left today`);
      setQuota({
        remaining: data.remaining,
        used_today: data.used_today,
        daily_quota: data.daily_quota,
        cooldown_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  let label = busy ? "Refreshing…" : "Force refresh";
  let title = "Re-poll the Odds API for this event right now (3 credits)";
  if (out) { label = "Daily limit hit"; title = "Resets at midnight UTC"; }
  else if (cooling) {
    const secs = Math.ceil((new Date(quota!.cooldown_until!).getTime() - Date.now()) / 1000);
    label = `Wait ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    title = "On cooldown for this event — wait a few minutes";
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
