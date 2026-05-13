"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, ExternalLink } from "lucide-react";

export interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  tier: "free" | "pro" | "elite";
  status: string;
  stripe_customer_id: string | null;
  invite_codes: string[];
}

const TIER_COLORS: Record<string, string> = {
  free: "bg-muted text-muted-foreground",
  pro: "bg-emerald-500/15 text-emerald-500",
  elite: "bg-amber-500/15 text-amber-500",
};

export default function AdminUsersTable({ initial, adminEmail }: { initial: AdminUserRow[]; adminEmail: string }) {
  const [users, setUsers] = useState(initial);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (tierFilter !== "all" && u.tier !== tierFilter) return false;
      if (needle && !(u.email || "").toLowerCase().includes(needle) && !u.id.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [users, q, tierFilter]);

  async function setTier(user: AdminUserRow, tier: "free" | "pro" | "elite") {
    if (user.tier === tier) return;
    const prev = users;
    setUsers(users.map((u) => u.id === user.id ? { ...u, tier } : u));
    const r = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      toast.error(data.error || "Failed to change tier");
      setUsers(prev);
    } else {
      toast.success(`${user.email} → ${tier}`);
    }
  }

  async function deleteUser(user: AdminUserRow) {
    if (user.email === adminEmail) {
      toast.error("Can't delete yourself.");
      return;
    }
    if (!confirm(`Delete ${user.email}? This removes their account, subscription, rules, and dispatches. Cannot be undone.`)) return;
    const r = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      toast.error(data.error || "Delete failed");
      return;
    }
    setUsers(users.filter((u) => u.id !== user.id));
    toast.success("User deleted");
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-3 flex items-center gap-2 border-b border-border/40 flex-wrap">
          <Input
            placeholder="Search by email or ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs h-8"
          />
          <div className="flex gap-1 text-xs">
            {(["all", "elite", "pro", "free"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`px-2 py-1 rounded ${tierFilter === t ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:bg-muted/30"}`}
              >
                {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} shown</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Joined</th>
                <th className="px-3 py-2 text-left">Last sign in</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Stripe</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:text-emerald-500 hover:underline inline-flex items-center gap-1">
                      {u.email || "(no email)"}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </Link>
                    <div className="text-[10px] text-muted-foreground/70 font-mono">{u.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.tier}
                      onChange={(e) => setTier(u, e.target.value as "free" | "pro" | "elite")}
                      className={`text-xs rounded px-2 py-1 border-0 ${TIER_COLORS[u.tier]}`}
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="elite">Elite</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {u.invite_codes.length > 0 ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15 text-[10px]">
                        Invite: {u.invite_codes[0]}
                      </Badge>
                    ) : u.stripe_customer_id ? (
                      <Badge className="bg-sky-500/15 text-sky-500 hover:bg-sky-500/15 text-[10px]">Stripe</Badge>
                    ) : (
                      <span className="text-muted-foreground/60 text-[10px]">organic</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-muted-foreground font-mono">
                    {u.stripe_customer_id ? u.stripe_customer_id.slice(0, 10) + "…" : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={u.email === adminEmail}
                      className="text-rose-500 hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={u.email === adminEmail ? "Can't delete yourself" : "Delete user"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
