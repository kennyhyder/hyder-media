"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, X, Check } from "lucide-react";
import { fmtAmerican, bookLabel } from "@/lib/format";
import type { Bet } from "@/lib/bet-score";
import { americanToImplied, americanToDecimal } from "@/lib/bet-score";

interface Props {
  initialBets: Bet[];
}

interface SbBetRow extends Bet {
  event_label: string;
  contestant_label: string;
  book: string;
  market_type: string;
  placed_at: string;
  result_at: string | null;
  league: string | null;
  notes: string | null;
}

const BOOK_OPTIONS = [
  { value: "kalshi", label: "Kalshi" },
  { value: "polymarket", label: "Polymarket" },
  { value: "draftkings", label: "DraftKings" },
  { value: "fanduel", label: "FanDuel" },
  { value: "betmgm", label: "BetMGM" },
  { value: "caesars", label: "Caesars" },
  { value: "betrivers", label: "BetRivers" },
  { value: "fanatics", label: "Fanatics" },
  { value: "bovada", label: "Bovada" },
  { value: "other", label: "Other" },
];

const MARKET_TYPES = [
  { value: "moneyline", label: "Moneyline / Winner" },
  { value: "spread", label: "Spread" },
  { value: "total_over", label: "Total — Over" },
  { value: "total_under", label: "Total — Under" },
  { value: "prop", label: "Prop / Other" },
];

export default function BetsPanel({ initialBets }: Props) {
  const [bets, setBets] = useState<SbBetRow[]>(initialBets as SbBetRow[]);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function createBet(input: Record<string, unknown>) {
    const r = await fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await r.json();
    if (!r.ok) { toast.error(data.error || "Failed"); return null; }
    setBets([data.bet, ...bets]);
    toast.success("Bet logged");
    startTransition(() => router.refresh());
    return data.bet;
  }

  async function settleBet(id: string, status: "won" | "lost" | "push" | "void") {
    const r = await fetch(`/api/bets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await r.json();
    if (!r.ok) { toast.error(data.error || "Failed"); return; }
    setBets(bets.map((b) => (b.id === id ? data.bet : b)));
    toast.success(`Marked ${status}`);
    startTransition(() => router.refresh());
  }

  async function deleteBet(b: SbBetRow) {
    if (!confirm(`Delete bet on ${b.contestant_label}?`)) return;
    const r = await fetch(`/api/bets/${b.id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("Failed"); return; }
    setBets(bets.filter((x) => x.id !== b.id));
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My bets ({bets.length})</h2>
        <Button onClick={() => setShowForm(!showForm)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Plus className="h-4 w-4 mr-1" aria-hidden="true" />New bet
        </Button>
      </div>

      {showForm && (
        <AddBetForm
          onSubmit={async (input) => {
            const ok = await createBet(input);
            if (ok) setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Placed</th>
                <th className="px-3 py-2 text-left">Event / Pick</th>
                <th className="px-3 py-2 text-left">Book</th>
                <th className="px-3 py-2 text-right">Odds</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {bets.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(b.placed_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{b.contestant_label}</div>
                    <div className="text-[11px] text-muted-foreground">{b.event_label} · <span className="capitalize">{b.market_type.replace("_", " ")}</span></div>
                  </td>
                  <td className="px-3 py-2 text-xs">{bookLabel(b.book)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtAmerican(b.line_american)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.stake_units} u</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${b.profit_units == null ? "" : b.profit_units > 0 ? "text-emerald-500" : b.profit_units < 0 ? "text-rose-500" : ""}`}>
                    {b.profit_units != null ? `${b.profit_units > 0 ? "+" : ""}${b.profit_units.toFixed(2)} u` : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {b.status === "pending" ? (
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => settleBet(b.id, "won")}
                          className="text-emerald-500 hover:text-emerald-400 px-1"
                          title="Mark won"
                          aria-label="Mark won"
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => settleBet(b.id, "lost")}
                          className="text-rose-500 hover:text-rose-400 px-1"
                          title="Mark lost"
                          aria-label="Mark lost"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => settleBet(b.id, "push")}
                          className="text-muted-foreground hover:text-foreground text-xs px-2"
                          title="Mark push"
                        >
                          P
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => deleteBet(b)} className="text-rose-500/60 hover:text-rose-500" aria-label="Delete bet">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {bets.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  No bets logged yet. Click <strong>New bet</strong> to start tracking.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    won: { label: "Won", cls: "bg-emerald-500/15 text-emerald-500" },
    lost: { label: "Lost", cls: "bg-rose-500/15 text-rose-500" },
    push: { label: "Push", cls: "bg-sky-500/15 text-sky-500" },
    void: { label: "Void", cls: "bg-muted text-muted-foreground" },
  };
  const info = map[status] || map.pending;
  return <span className={`text-[10px] px-2 py-0.5 rounded ${info.cls}`}>{info.label}</span>;
}

function AddBetForm({ onSubmit, onCancel }: { onSubmit: (input: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({
    event_label: "",
    contestant_label: "",
    market_type: "moneyline",
    line_american: "",
    book: "draftkings",
    stake_units: "1",
    user_stated_prob: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const american = Number(form.line_american);
  const implied = Number.isFinite(american) && american !== 0 ? americanToImplied(american) : null;
  const decimal = Number.isFinite(american) && american !== 0 ? americanToDecimal(american) : null;
  const stake = Number(form.stake_units);
  const potentialReturn = implied != null && decimal != null ? stake * decimal : null;
  const potentialProfit = potentialReturn != null ? potentialReturn - stake : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const input: Record<string, unknown> = {
      event_label: form.event_label,
      contestant_label: form.contestant_label,
      market_type: form.market_type,
      line_american: Number(form.line_american),
      book: form.book,
      stake_units: Number(form.stake_units),
    };
    if (form.user_stated_prob) input.user_stated_prob = Number(form.user_stated_prob) / 100;
    if (form.notes) input.notes = form.notes;
    await onSubmit(input);
    setSubmitting(false);
  }

  return (
    <Card className="border-emerald-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          New bet
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground" aria-label="Cancel">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="event_label">Event</Label>
              <Input
                id="event_label"
                value={form.event_label}
                onChange={(e) => setForm({ ...form, event_label: e.target.value })}
                placeholder="e.g. Lakers vs Spurs"
                required
              />
            </div>
            <div>
              <Label htmlFor="contestant_label">Your pick</Label>
              <Input
                id="contestant_label"
                value={form.contestant_label}
                onChange={(e) => setForm({ ...form, contestant_label: e.target.value })}
                placeholder="e.g. Lakers"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="market_type">Market</Label>
              <select
                id="market_type"
                value={form.market_type}
                onChange={(e) => setForm({ ...form, market_type: e.target.value })}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              >
                {MARKET_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="book">Book</Label>
              <select
                id="book"
                value={form.book}
                onChange={(e) => setForm({ ...form, book: e.target.value })}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              >
                {BOOK_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="line_american">Odds (American)</Label>
              <Input
                id="line_american"
                type="number"
                value={form.line_american}
                onChange={(e) => setForm({ ...form, line_american: e.target.value })}
                placeholder="-110, +200"
                required
              />
            </div>
            <div>
              <Label htmlFor="stake_units">Stake (units)</Label>
              <Input
                id="stake_units"
                type="number"
                step="0.1"
                min="0.1"
                value={form.stake_units}
                onChange={(e) => setForm({ ...form, stake_units: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="user_stated_prob">Your fair probability <span className="text-muted-foreground">(optional — improves calibration score)</span></Label>
            <div className="flex items-center gap-2">
              <Input
                id="user_stated_prob"
                type="number"
                step="0.5"
                min="1"
                max="99"
                value={form.user_stated_prob}
                onChange={(e) => setForm({ ...form, user_stated_prob: e.target.value })}
                placeholder={implied ? `Implied: ${(implied * 100).toFixed(1)}` : "e.g. 55"}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>

          {implied != null && potentialReturn != null && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs grid grid-cols-3 gap-2">
              <div><span className="text-muted-foreground">Implied:</span> <strong className="text-foreground tabular-nums">{(implied * 100).toFixed(1)}%</strong></div>
              <div><span className="text-muted-foreground">Decimal:</span> <strong className="text-foreground tabular-nums">{decimal!.toFixed(3)}</strong></div>
              <div><span className="text-muted-foreground">If wins:</span> <strong className="text-emerald-500 tabular-nums">+{potentialProfit!.toFixed(2)} u</strong></div>
            </div>
          )}

          <div>
            <Label htmlFor="notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="why you took this side"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-border/40">
            <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              {submitting ? "Logging…" : "Log bet"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
