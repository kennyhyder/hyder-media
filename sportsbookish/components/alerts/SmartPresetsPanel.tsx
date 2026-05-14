"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Mail, Smartphone, Star } from "lucide-react";
import { SMART_PRESETS, type AlertRule } from "@/lib/alert-rules";

interface Props {
  existing: AlertRule[];      // current user's rules; we detect enabled presets via preset_key
  hasWatchlist: boolean;
  hasPhone: boolean;
}

export default function SmartPresetsPanel({ existing, hasWatchlist, hasPhone }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const enabledByKey = new Map<string, AlertRule>();
  for (const r of existing) {
    if (r.preset_key) enabledByKey.set(r.preset_key, r);
  }

  async function enablePreset(key: string) {
    setBusy(key);
    try {
      const r = await fetch("/api/alerts/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_key: key }),
      });
      const data = await r.json();
      if (!r.ok) { toast.error(data.error || "Failed"); return; }
      toast.success(`Enabled ${SMART_PRESETS.find((p) => p.key === key)?.name}`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function togglePreset(rule: AlertRule) {
    setBusy(rule.preset_key!);
    try {
      const r = await fetch(`/api/alerts/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!r.ok) { toast.error("Failed"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deletePreset(rule: AlertRule) {
    if (!confirm("Remove this preset?")) return;
    setBusy(rule.preset_key!);
    try {
      const r = await fetch(`/api/alerts/rules/${rule.id}`, { method: "DELETE" });
      if (!r.ok) { toast.error("Failed"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-lg font-semibold">Smart presets</h2>
        <span className="text-xs text-muted-foreground">One-click toggles. No setup.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SMART_PRESETS.map((preset) => {
          const enabled = enabledByKey.get(preset.key);
          const requiresWatchlist = preset.key === "my_watchlist";
          const disabledReason = requiresWatchlist && !hasWatchlist ? "Add at least one team or player to your watchlist first." : null;
          return (
            <Card key={preset.key} className={enabled?.enabled ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-semibold">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">{preset.description}</div>
                  </div>
                  {enabled && (
                    <button
                      onClick={() => togglePreset(enabled)}
                      disabled={busy === preset.key}
                      className={`text-[10px] px-2 py-0.5 rounded ${enabled.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}
                    >
                      {enabled.enabled ? "On" : "Paused"}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Δ ≥ <strong className="text-foreground">{((preset.defaults.min_delta || 0) * 100).toFixed(0)}%</strong></span>
                  {preset.defaults.channels?.includes("email") && <Mail className="h-3 w-3" />}
                  {preset.defaults.channels?.includes("sms") && hasPhone && <Smartphone className="h-3 w-3" />}
                  {preset.defaults.watchlist_only && <Star className="h-3 w-3 text-amber-500" />}
                  {enabled && enabled.fire_count > 0 && <span className="text-muted-foreground/70">{enabled.fire_count} fired</span>}
                </div>
                {disabledReason && <div className="text-xs text-amber-500">{disabledReason}</div>}
                <div className="pt-1">
                  {enabled ? (
                    <Button size="sm" variant="outline" onClick={() => deletePreset(enabled)} disabled={busy === preset.key} className="text-rose-500 text-xs">
                      Remove
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => enablePreset(preset.key)}
                      disabled={busy === preset.key || !!disabledReason}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                    >
                      {busy === preset.key ? "Enabling…" : "Enable"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
