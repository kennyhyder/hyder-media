"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Copy, Plus } from "lucide-react";

export interface InviteCodeRow {
  code: string;
  tier: "free" | "pro" | "elite";
  label: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  disabled: boolean;
  created_at: string;
}

export interface RedemptionRow {
  code: string;
  user_id: string;
  email: string | null;
  tier: string;
  redeemed_at: string;
}

const SITE_URL = typeof window !== "undefined" ? window.location.origin : "https://sportsbookish.com";

export default function AdminInvitesPanel({ initialCodes, redemptions }: { initialCodes: InviteCodeRow[]; redemptions: RedemptionRow[] }) {
  const [codes, setCodes] = useState(initialCodes);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", prefix: "", tier: "elite" as "free" | "pro" | "elite", label: "", max_uses: 1, expires_at: "" });
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const body: Record<string, unknown> = {
      tier: form.tier,
      label: form.label || null,
      max_uses: form.max_uses,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };
    if (form.code) body.code = form.code;
    if (form.prefix && !form.code) body.prefix = form.prefix;
    const r = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    setSubmitting(false);
    if (!r.ok) { toast.error(data.error || "Failed"); return; }
    setCodes([data.code, ...codes]);
    setForm({ code: "", prefix: "", tier: "elite", label: "", max_uses: 1, expires_at: "" });
    setShowForm(false);
    toast.success(`Created ${data.code.code}`);
    router.refresh();
  }

  async function toggleDisabled(c: InviteCodeRow) {
    const r = await fetch(`/api/admin/invites/${c.code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !c.disabled }),
    });
    if (!r.ok) { toast.error("Failed"); return; }
    const data = await r.json();
    setCodes(codes.map((x) => x.code === c.code ? data.code : x));
  }

  async function deleteCode(c: InviteCodeRow) {
    if (!confirm(`Delete code ${c.code}? Existing redemptions stay (their users keep their tier).`)) return;
    const r = await fetch(`/api/admin/invites/${c.code}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Failed"); return; }
    setCodes(codes.filter((x) => x.code !== c.code));
  }

  function copyUrl(c: InviteCodeRow) {
    const url = `${SITE_URL}/redeem/${c.code}`;
    navigator.clipboard.writeText(url);
    toast.success(`Copied: ${url}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Invite codes</h2>
          <p className="text-xs text-muted-foreground">{codes.reduce((s, c) => s + c.uses, 0)} total redemptions across {codes.length} code{codes.length === 1 ? "" : "s"}.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Plus className="h-4 w-4 mr-1" />New code
        </Button>
      </div>

      {showForm && (
        <Card className="border-emerald-500/40">
          <CardContent className="p-5">
            <form onSubmit={createCode} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Custom code <span className="text-muted-foreground">(optional)</span></Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. EARLY-ACCESS" />
                </div>
                <div>
                  <Label>Prefix <span className="text-muted-foreground">(if code blank)</span></Label>
                  <Input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} placeholder="e.g. FRIEND" />
                </div>
                <div>
                  <Label>Tier</Label>
                  <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as "free" | "pro" | "elite" })} className="w-full rounded border border-border bg-background px-3 py-2 text-sm">
                    <option value="elite">Elite ($39/mo equivalent)</option>
                    <option value="pro">Pro ($19/mo equivalent)</option>
                    <option value="free">Free</option>
                  </select>
                </div>
                <div>
                  <Label>Max uses</Label>
                  <Input type="number" min="1" max="10000" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Label <span className="text-muted-foreground">(internal note)</span></Label>
                  <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. press, friends" />
                </div>
                <div>
                  <Label>Expires <span className="text-muted-foreground">(optional)</span></Label>
                  <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-border/40">
                <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white">{submitting ? "Creating…" : "Create code"}</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-right">Uses</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {codes.map((c) => (
                <tr key={c.code} className={`hover:bg-muted/30 ${c.disabled ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/redeem/${c.code}`} className="font-mono hover:text-emerald-500 hover:underline" target="_blank">{c.code}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs uppercase">{c.tier}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.label || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{c.uses} / {c.max_uses}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "never"}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleDisabled(c)} className={`text-[10px] px-2 py-0.5 rounded ${c.disabled ? "bg-rose-500/15 text-rose-500" : "bg-emerald-500/15 text-emerald-500"}`}>
                      {c.disabled ? "Disabled" : "Active"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right flex gap-2 justify-end">
                    <button onClick={() => copyUrl(c)} className="text-muted-foreground hover:text-foreground" title="Copy redemption URL">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button onClick={() => deleteCode(c)} className="text-rose-500 hover:text-rose-400" title="Delete code">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {codes.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No invite codes yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent redemptions ({redemptions.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Tier granted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {redemptions.map((r, i) => (
                <tr key={`${r.code}-${r.user_id}-${i}`} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.redeemed_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-3 py-2">{r.email || <span className="text-muted-foreground/60 font-mono">{r.user_id.slice(0, 8)}…</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2"><Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15 text-[10px] uppercase">{r.tier}</Badge></td>
                </tr>
              ))}
              {redemptions.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No redemptions yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
