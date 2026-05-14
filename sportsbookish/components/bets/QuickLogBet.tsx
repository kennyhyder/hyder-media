"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X, Lock } from "lucide-react";
import { fmtAmerican, bookLabel } from "@/lib/format";
import { americanToImplied, americanToDecimal } from "@/lib/bet-score";

interface ContestantOption {
  label: string;
  kalshi_implied: number | null;
  polymarket_implied: number | null;
  book_prices: Record<string, { american: number | null; novig: number | null }>;
}

interface Props {
  eventId: string;
  eventLabel: string;
  league: string;
  contestants: ContestantOption[];
  tier: "free" | "pro" | "elite";
  isAnonymous: boolean;
}

// "Log this bet" widget shown on event detail pages. Pre-populates the
// AddBetForm with live event data so users don't type anything except stake.
// Elite-only; free/pro/anonymous see an upsell.
export default function QuickLogBet({ eventId, eventLabel, league, contestants, tier, isAnonymous }: Props) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(contestants[0]?.label || "");
  const [book, setBook] = useState<string>("kalshi");
  const [stake, setStake] = useState("1");
  const [statedProb, setStatedProb] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const pickRow = useMemo(() => contestants.find((c) => c.label === pick) || contestants[0], [pick, contestants]);

  // List of books available for the picked contestant
  const availableBooks = useMemo(() => {
    if (!pickRow) return [] as { value: string; label: string; american: number | null }[];
    const out: { value: string; label: string; american: number | null }[] = [];
    // Kalshi
    if (pickRow.kalshi_implied != null) {
      const k = pickRow.kalshi_implied;
      // Convert Kalshi prob to American odds for log consistency
      const american = k >= 0.5 ? Math.round(-100 * k / (1 - k)) : Math.round(100 * (1 - k) / k);
      out.push({ value: "kalshi", label: "Kalshi", american });
    }
    if (pickRow.polymarket_implied != null) {
      const p = pickRow.polymarket_implied;
      const american = p >= 0.5 ? Math.round(-100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
      out.push({ value: "polymarket", label: "Polymarket", american });
    }
    // Sportsbooks
    for (const [bk, px] of Object.entries(pickRow.book_prices || {})) {
      if (px?.american != null) out.push({ value: bk, label: bookLabel(bk), american: px.american });
    }
    out.push({ value: "other", label: "Other (manual odds)", american: null });
    return out;
  }, [pickRow]);

  const selectedBook = availableBooks.find((b) => b.value === book) || availableBooks[0];
  const odds = selectedBook?.american ?? null;
  const implied = odds != null ? americanToImplied(odds) : null;
  const decimal = odds != null ? americanToDecimal(odds) : null;
  const stakeNum = Number(stake);
  const potentialProfit = decimal != null && Number.isFinite(stakeNum) ? stakeNum * (decimal - 1) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (odds == null) {
      toast.error("No odds available for this book — pick a different book or use 'Other'");
      return;
    }
    setSubmitting(true);
    const r = await fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        event_label: eventLabel,
        contestant_label: pick,
        league,
        book,
        line_american: odds,
        stake_units: stakeNum,
        market_type: "moneyline",
        user_stated_prob: statedProb ? Number(statedProb) / 100 : undefined,
        notes: notes || undefined,
      }),
    });
    const data = await r.json();
    setSubmitting(false);
    if (!r.ok) { toast.error(data.error || "Failed"); return; }
    toast.success(`Logged bet on ${pick} at ${bookLabel(book)} ${fmtAmerican(odds)}`);
    setOpen(false);
    setStake("1");
    setNotes("");
    setStatedProb("");
    router.refresh();
  }

  // Elite gating
  if (tier !== "elite") {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mb-4 flex items-center justify-between gap-3 flex-wrap text-sm">
        <span className="text-foreground/80 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <span><strong>Bet Tracker</strong> — log this bet + score your edge identification over time.</span>
        </span>
        <Link
          href={isAnonymous ? "/signup?next=/pricing" : "/pricing"}
          className="text-xs rounded bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 font-semibold"
        >
          {isAnonymous ? "Sign up" : "Get Elite"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4">
      {!open ? (
        <Button onClick={() => setOpen(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Plus className="h-4 w-4 mr-1" aria-hidden="true" />Log a bet on this game
        </Button>
      ) : (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">New bet on {eventLabel}</div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cancel">
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" aria-hidden="true" />
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qlb-pick">Pick</Label>
                <select
                  id="qlb-pick"
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  {contestants.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="qlb-book">Book</Label>
                <select
                  id="qlb-book"
                  value={book}
                  onChange={(e) => setBook(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                >
                  {availableBooks.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}{b.american != null ? ` (${b.american > 0 ? "+" : ""}${b.american})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="qlb-stake">Stake (units)</Label>
                <Input
                  id="qlb-stake"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="qlb-prob">Your fair % <span className="text-muted-foreground/70 text-[10px]">(opt.)</span></Label>
                <Input
                  id="qlb-prob"
                  type="number"
                  step="0.5"
                  min="1"
                  max="99"
                  value={statedProb}
                  onChange={(e) => setStatedProb(e.target.value)}
                  placeholder={implied != null ? (implied * 100).toFixed(1) : ""}
                />
              </div>
              <div>
                <Label htmlFor="qlb-notes">Notes <span className="text-muted-foreground/70 text-[10px]">(opt.)</span></Label>
                <Input
                  id="qlb-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="why this side"
                />
              </div>
            </div>

            {odds != null && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs grid grid-cols-4 gap-2">
                <div><span className="text-muted-foreground">Odds:</span> <strong className="tabular-nums">{fmtAmerican(odds)}</strong></div>
                <div><span className="text-muted-foreground">Implied:</span> <strong className="tabular-nums">{implied != null ? (implied * 100).toFixed(1) + "%" : "—"}</strong></div>
                <div><span className="text-muted-foreground">Decimal:</span> <strong className="tabular-nums">{decimal?.toFixed(3) ?? "—"}</strong></div>
                <div><span className="text-muted-foreground">If wins:</span> <strong className="text-emerald-500 tabular-nums">+{potentialProfit?.toFixed(2) ?? "—"} u</strong></div>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-border/40">
              <Button type="submit" disabled={submitting || odds == null} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                {submitting ? "Logging…" : "Log bet"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Link href="/bets" className="ml-auto text-xs text-muted-foreground hover:text-foreground self-center">
                View all bets →
              </Link>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
