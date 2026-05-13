"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, Smartphone, Trash2, Send, RefreshCw } from "lucide-react";

export interface UserDetailData {
  user: {
    id: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
    phone: string | null;
  };
  subscription: {
    tier: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  } | null;
  preferences: {
    home_book: string | null;
    excluded_books: string[] | null;
    sms_phone: string | null;
  } | null;
  redemptions: { code: string; tier: string; redeemed_at: string }[];
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    leagues: string[] | null;
    alert_types: string[] | null;
    min_delta: number;
    channels: string[];
    fire_count: number;
    last_fired_at: string | null;
  }[];
  dispatches: {
    rule_id: string;
    alert_source: string;
    alert_id: string;
    channels: string[];
    email_status: string | null;
    sms_status: string | null;
    dispatched_at: string;
    snapshot: { title?: string; subtitle?: string; alert_type?: string; delta?: number; league?: string } | null;
  }[];
}

const TIER_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-emerald-500/15 text-emerald-500",
  elite: "bg-amber-500/15 text-amber-500",
};

export default function AdminUserDetail({ data, adminEmail }: { data: UserDetailData; adminEmail: string }) {
  const [tier, setTier] = useState(data.subscription?.tier || "free");
  const [working, setWorking] = useState(false);
  const router = useRouter();
  const isSelf = data.user.email === adminEmail;

  async function setUserTier(newTier: "free" | "pro" | "elite") {
    if (newTier === tier) return;
    setWorking(true);
    const r = await fetch(`/api/admin/users/${data.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: newTier }),
    });
    setWorking(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast.error(body.error || "Failed");
      return;
    }
    setTier(newTier);
    toast.success(`${data.user.email} → ${newTier}`);
    router.refresh();
  }

  async function sendMagicLink() {
    if (!data.user.email) return;
    setWorking(true);
    const r = await fetch(`/api/admin/users/${data.user.id}/magic-link`, { method: "POST" });
    setWorking(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast.error(body.error || "Failed to send");
      return;
    }
    toast.success(`Magic link sent to ${data.user.email}`);
  }

  async function deleteUser() {
    if (isSelf) { toast.error("Can't delete yourself"); return; }
    if (!confirm(`Delete ${data.user.email}? This removes the account, subscription, alert rules, dispatches, and redemption history. Cannot be undone.`)) return;
    setWorking(true);
    const r = await fetch(`/api/admin/users/${data.user.id}`, { method: "DELETE" });
    setWorking(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      toast.error(body.error || "Delete failed");
      return;
    }
    toast.success("User deleted");
    router.push("/admin");
  }

  const dispatchSuccessCount = data.dispatches.filter((d) => d.email_status === "sent").length;
  const dispatchFailCount = data.dispatches.filter((d) => d.email_status === "failed").length;

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xl font-semibold">{data.user.email}</div>
              <div className="text-xs text-muted-foreground font-mono mt-1">{data.user.id}</div>
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                <span>Joined {data.user.created_at ? new Date(data.user.created_at).toLocaleDateString() : "?"}</span>
                <span>·</span>
                <span>Last sign-in {data.user.last_sign_in_at ? new Date(data.user.last_sign_in_at).toLocaleString() : "never"}</span>
                {data.user.email_confirmed_at && <><span>·</span><span className="text-emerald-500">Email confirmed</span></>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <select
                value={tier}
                onChange={(e) => setUserTier(e.target.value as "free" | "pro" | "elite")}
                disabled={working}
                className={`text-sm rounded px-3 py-1.5 border-0 ${TIER_COLORS[tier]}`}
              >
                <option value="free">Free</option>
                <option value="pro">Pro ($19)</option>
                <option value="elite">Elite ($39)</option>
              </select>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={working || !data.user.email} onClick={sendMagicLink} title="Send magic link to user's email">
                  <Send className="h-3 w-3 mr-1" />Magic link
                </Button>
                <Button size="sm" variant="outline" disabled={working || isSelf} onClick={deleteUser} className="text-rose-500" title={isSelf ? "Can't delete yourself" : "Delete user"}>
                  <Trash2 className="h-3 w-3 mr-1" />Delete
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Subscription */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Subscription</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Tier" value={<Badge className={`uppercase text-[10px] ${TIER_COLORS[tier]}`}>{tier}</Badge>} />
            <Row label="Status" value={data.subscription?.status || "no record"} />
            {data.subscription?.stripe_customer_id ? (
              <>
                <Row label="Stripe customer" value={<span className="font-mono text-xs">{data.subscription.stripe_customer_id}</span>} />
                {data.subscription.stripe_subscription_id && <Row label="Stripe sub" value={<span className="font-mono text-xs">{data.subscription.stripe_subscription_id}</span>} />}
                <Row label="Period end" value={data.subscription.current_period_end ? new Date(data.subscription.current_period_end).toLocaleString() : "—"} />
                {data.subscription.cancel_at_period_end && <Row label="Cancelling" value={<Badge className="bg-rose-500/15 text-rose-500 text-[10px]">yes</Badge>} />}
              </>
            ) : (
              <div className="text-xs text-muted-foreground">No Stripe customer — granted via invite/admin.</div>
            )}
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Home book" value={data.preferences?.home_book || "—"} />
            <Row label="Excluded books" value={data.preferences?.excluded_books?.length ? data.preferences.excluded_books.join(", ") : "—"} />
            <Row label="SMS phone" value={data.preferences?.sms_phone || <span className="text-muted-foreground/60">not set</span>} />
          </CardContent>
        </Card>
      </div>

      {/* Redemptions */}
      {data.redemptions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Invite redemptions ({data.redemptions.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Code</th><th className="px-3 py-2 text-left">Tier granted</th></tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.redemptions.map((r) => (
                  <tr key={`${r.code}-${r.redeemed_at}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.redeemed_at).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2"><Badge className={`uppercase text-[10px] ${TIER_COLORS[r.tier]}`}>{r.tier}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Alert rules */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Alert rules ({data.rules.length})</span>
            <span className="text-xs font-normal text-muted-foreground">{data.rules.filter((r) => r.enabled).length} enabled · {data.rules.reduce((s, r) => s + r.fire_count, 0)} fired total</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.rules.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No rules.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Scope</th>
                  <th className="px-3 py-2 text-right">Min Δ</th>
                  <th className="px-3 py-2 text-center">Channels</th>
                  <th className="px-3 py-2 text-right">Fired</th>
                  <th className="px-3 py-2 text-left">Last fired</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.leagues?.length ? r.leagues.map((l) => l.toUpperCase()).join(", ") : "All sports"}
                      {" · "}
                      {(r.alert_types || ["all"]).join(", ")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{(r.min_delta * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center">
                      {r.channels.includes("email") && <Mail className="h-3 w-3 inline mx-0.5" />}
                      {r.channels.includes("sms") && <Smartphone className="h-3 w-3 inline mx-0.5" />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{r.fire_count}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.last_fired_at ? new Date(r.last_fired_at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-center"><Badge className={`text-[10px] ${r.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>{r.enabled ? "Enabled" : "Paused"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Recent dispatches */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Recent dispatches ({data.dispatches.length})</span>
            <span className="text-xs font-normal text-muted-foreground">{dispatchSuccessCount} sent · {dispatchFailCount} failed</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {data.dispatches.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No alerts have fired for this user yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                  <th className="px-3 py-2 text-center">Email</th>
                  <th className="px-3 py-2 text-center">SMS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.dispatches.map((d, i) => (
                  <tr key={`${d.rule_id}-${d.alert_id}-${i}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(d.dispatched_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-2">
                      <div>{d.snapshot?.title || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{d.snapshot?.subtitle || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{d.snapshot?.alert_type || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{d.snapshot?.delta != null ? `${d.snapshot.delta >= 0 ? "+" : ""}${(d.snapshot.delta * 100).toFixed(2)}%` : "—"}</td>
                    <td className="px-3 py-2 text-center text-xs"><StatusBadge status={d.email_status} /></td>
                    <td className="px-3 py-2 text-center text-xs"><StatusBadge status={d.sms_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground/40">—</span>;
  const colors: Record<string, string> = {
    sent: "bg-emerald-500/15 text-emerald-500",
    failed: "bg-rose-500/15 text-rose-500",
    pending: "bg-amber-500/15 text-amber-500",
  };
  return <Badge className={`text-[9px] ${colors[status] || "bg-muted text-muted-foreground"}`}>{status}</Badge>;
}
