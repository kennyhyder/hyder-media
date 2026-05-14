"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Mail, Smartphone, X } from "lucide-react";
import { ALL_LEAGUES, ALERT_TYPES, type AlertRule, type AlertRuleInput } from "@/lib/alert-rules";

interface Props {
  initialRules: AlertRule[];
  hasPhone: boolean;
  isElite: boolean;
}

const blankRule: AlertRuleInput = {
  name: "",
  enabled: true,
  sports: null,
  leagues: null,
  alert_types: ["movement"],
  direction: null,
  min_delta: 0.03,
  channels: ["email"],
};

export default function AlertRulesPanel({ initialRules, hasPhone, isElite }: Props) {
  const [rules, setRules] = useState<AlertRule[]>(initialRules);
  const [editing, setEditing] = useState<AlertRuleInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function saveRule(input: AlertRuleInput) {
    const isUpdate = !!editingId;
    const url = isUpdate ? `/api/alerts/rules/${editingId}` : `/api/alerts/rules`;
    const method = isUpdate ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await r.json();
    if (!r.ok) { toast.error(data.error || "Save failed"); return; }
    if (isUpdate) setRules(rules.map((x) => x.id === editingId ? data.rule : x));
    else setRules([data.rule, ...rules]);
    setEditing(null);
    setEditingId(null);
    toast.success(isUpdate ? "Rule updated" : "Rule created");
    startTransition(() => router.refresh());
  }

  async function toggleEnabled(rule: AlertRule) {
    const r = await fetch(`/api/alerts/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!r.ok) { toast.error("Toggle failed"); return; }
    const data = await r.json();
    setRules(rules.map((x) => x.id === rule.id ? data.rule : x));
  }

  async function deleteRule(rule: AlertRule) {
    if (!confirm(`Delete "${rule.name}"?`)) return;
    const r = await fetch(`/api/alerts/rules/${rule.id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Delete failed"); return; }
    setRules(rules.filter((x) => x.id !== rule.id));
    toast.success("Rule deleted");
  }

  function startEditing(rule: AlertRule | null) {
    if (rule) {
      setEditingId(rule.id);
      setEditing({
        name: rule.name, enabled: rule.enabled, sports: rule.sports,
        leagues: rule.leagues, alert_types: rule.alert_types, direction: rule.direction,
        min_delta: rule.min_delta, channels: rule.channels,
        min_kalshi_prob: rule.min_kalshi_prob, max_kalshi_prob: rule.max_kalshi_prob,
      });
    } else {
      setEditingId(null);
      setEditing({ ...blankRule });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">My alert rules ({rules.length})</h2>
          <p className="text-xs text-muted-foreground">Each rule fires email/SMS when a matching alert is detected.</p>
        </div>
        <Button onClick={() => startEditing(null)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Plus className="h-4 w-4 mr-1" />New rule
        </Button>
      </div>

      {editing && (
        <RuleForm
          input={editing}
          editingId={editingId}
          hasPhone={hasPhone}
          isElite={isElite}
          onSave={saveRule}
          onCancel={() => { setEditing(null); setEditingId(null); }}
        />
      )}

      {rules.length === 0 && !editing && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No alert rules yet. Click <strong className="text-foreground">New rule</strong> to set one up.
            <div className="mt-4 text-xs">Examples:</div>
            <ul className="text-xs mt-2 space-y-1">
              <li>&ldquo;Big NBA moves&rdquo; → NBA, movement, min 5%</li>
              <li>&ldquo;Golf buy edges&rdquo; → PGA, edge_buy, min 3%</li>
              <li>&ldquo;Any sport, big move&rdquo; → no sport filter, movement, min 7%</li>
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rules.map((rule) => (
          <Card key={rule.id} className={rule.enabled ? "" : "opacity-50"}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold truncate">{rule.name}</div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleEnabled(rule)}
                    className={`text-[10px] px-2 py-0.5 rounded ${rule.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}
                  >
                    {rule.enabled ? "Enabled" : "Paused"}
                  </button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  <strong className="text-foreground">{rule.leagues?.length ? rule.leagues.map((l) => l.toUpperCase()).join(", ") : "All sports"}</strong>
                  {" · "}
                  {(rule.alert_types || ["movement", "edge_buy", "edge_sell"]).map((t) => ALERT_TYPES.find((x) => x.key === t)?.label.split(" ")[0] || t).join(", ")}
                </div>
                <div>
                  Min Δ <strong className="text-foreground tabular-nums">{(rule.min_delta * 100).toFixed(1)}%</strong>
                  {rule.direction && <> · only <strong className="text-foreground">{rule.direction}</strong></>}
                </div>
                <div className="flex items-center gap-2">
                  Delivery:
                  {rule.channels.includes("email") && <Mail className="h-3 w-3" />}
                  {rule.channels.includes("sms") && <Smartphone className="h-3 w-3" />}
                  <span>{rule.channels.join(", ")}</span>
                </div>
                {rule.fire_count > 0 && (
                  <div className="text-muted-foreground/70">
                    {rule.fire_count} fired
                    {rule.last_fired_at && <> · last {new Date(rule.last_fired_at).toLocaleString()}</>}
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => startEditing(rule)} className={`${buttonVariants({ variant: "outline", size: "sm" })} text-xs`}>Edit</button>
                <button onClick={() => deleteRule(rule)} className={`${buttonVariants({ variant: "outline", size: "sm" })} text-xs text-rose-500`}>
                  <Trash2 className="h-3 w-3 mr-1" />Delete
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RuleForm({ input, editingId, hasPhone, isElite, onSave, onCancel }: {
  input: AlertRuleInput;
  editingId: string | null;
  hasPhone: boolean;
  isElite: boolean;
  onSave: (i: AlertRuleInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AlertRuleInput>(input);
  const [submitting, setSubmitting] = useState(false);

  function toggleArray<T extends string>(field: "sports" | "leagues" | "alert_types" | "channels", value: T) {
    const current = (form[field] as string[] | null) || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setForm({ ...form, [field]: next.length === 0 ? null : next });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await onSave(form);
    setSubmitting(false);
  }

  return (
    <Card className="border-emerald-500/40">
      <CardContent className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{editingId ? "Edit rule" : "New rule"}</div>
            <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <Label htmlFor="name">Name <span className="text-muted-foreground">(internal label)</span></Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Big NBA moves, Golf buy edges"
              required
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs">Sports/leagues <span className="text-muted-foreground">(none selected = all)</span></Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
              {ALL_LEAGUES.map((l) => (
                <label key={l.key} className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded cursor-pointer border ${(form.leagues || []).includes(l.key) ? "bg-emerald-500/10 border-emerald-500/40 text-foreground" : "border-border hover:bg-muted/30"}`}>
                  <input
                    type="checkbox"
                    checked={(form.leagues || []).includes(l.key)}
                    onChange={() => toggleArray("leagues", l.key)}
                    className="sr-only"
                  />
                  <span className="text-base">{l.icon}</span>
                  <span>{l.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Alert types <span className="text-muted-foreground">(none = all)</span></Label>
            <div className="space-y-1 mt-1">
              {ALERT_TYPES.map((t) => (
                <label key={t.key} className={`flex items-start gap-2 text-sm px-2 py-1.5 rounded cursor-pointer border ${(form.alert_types || []).includes(t.key) ? "bg-emerald-500/10 border-emerald-500/40 text-foreground" : "border-border hover:bg-muted/30"}`}>
                  <input
                    type="checkbox"
                    checked={(form.alert_types || []).includes(t.key)}
                    onChange={() => toggleArray("alert_types", t.key)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground">{t.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="min_delta">Minimum threshold</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="min_delta"
                  type="number"
                  step="0.5"
                  min="0.1"
                  max="100"
                  value={(form.min_delta || 0.03) * 100}
                  onChange={(e) => setForm({ ...form, min_delta: Number(e.target.value) / 100 })}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <Label htmlFor="direction">Direction</Label>
              <select
                id="direction"
                value={form.direction || ""}
                onChange={(e) => setForm({ ...form, direction: (e.target.value || null) as "up" | "down" | null })}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Both directions</option>
                <option value="up">Up only (Kalshi rising / buy edge)</option>
                <option value="down">Down only (Kalshi falling / sell edge)</option>
              </select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Delivery</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              <label className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded cursor-pointer border ${(form.channels || []).includes("email") ? "bg-emerald-500/10 border-emerald-500/40 text-foreground" : "border-border hover:bg-muted/30"}`}>
                <input
                  type="checkbox"
                  checked={(form.channels || []).includes("email")}
                  onChange={() => toggleArray("channels", "email")}
                  className="sr-only"
                />
                <Mail className="h-4 w-4" />Email
              </label>
              <label className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded cursor-pointer border ${(form.channels || []).includes("sms") && isElite ? "bg-emerald-500/10 border-emerald-500/40 text-foreground" : "border-border hover:bg-muted/30"} ${!isElite || !hasPhone ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={(form.channels || []).includes("sms")}
                  onChange={() => toggleArray("channels", "sms")}
                  disabled={!isElite || !hasPhone}
                  className="sr-only"
                />
                <Smartphone className="h-4 w-4" />SMS
                {!isElite && <Link href="/pricing" className="text-[10px] text-amber-500 hover:underline">Elite</Link>}
                {isElite && !hasPhone && <Link href="/settings" className="text-[10px] text-amber-500 hover:underline">add phone</Link>}
              </label>
            </div>
            {!isElite && <p className="text-[10px] text-muted-foreground mt-1">Pro is email only. <Link href="/pricing" className="text-emerald-500 hover:underline">Upgrade to Elite</Link> for SMS + smart presets + watchlist filtering.</p>}
          </div>

          <div className="flex gap-2 pt-2 border-t border-border/40">
            <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              {submitting ? "Saving…" : editingId ? "Save changes" : "Create rule"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
