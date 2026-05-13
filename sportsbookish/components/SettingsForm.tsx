"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Props {
  tier: "pro" | "elite" | string;
  initial: {
    home_book: string | null;
    excluded_books: string[];
    notification_channels: string[];
    sms_phone: string | null;
    alert_thresholds: Record<string, { buy?: number; sell?: number }>;
  };
  allBooks: string[];
}

const BOOK_LABELS: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  circa: "Circa",
  pinnacle: "Pinnacle",
  bet365: "bet365",
  betonline: "BetOnline",
  bovada: "Bovada",
  skybet: "SkyBet",
  williamhill: "William Hill",
  pointsbet: "PointsBet",
  unibet: "Unibet",
  betcris: "Betcris",
};

export default function SettingsForm({ tier, initial, allBooks }: Props) {
  const [homeBook, setHomeBook] = useState<string>(initial.home_book ?? "");
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initial.excluded_books));
  const [smsPhone, setSmsPhone] = useState(initial.sms_phone ?? "");
  const [channels, setChannels] = useState<Set<string>>(new Set(initial.notification_channels));
  const [saving, setSaving] = useState(false);

  function toggleExcluded(book: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(book)) next.delete(book);
      else next.add(book);
      return next;
    });
  }

  function toggleChannel(ch: string) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        home_book: homeBook || null,
        excluded_books: Array.from(excluded),
      };
      if (tier === "elite") {
        body.notification_channels = Array.from(channels);
        body.sms_phone = smsPhone || null;
      }
      const r = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || `${r.status}`);
      }
      toast.success("Preferences saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your home sportsbook</CardTitle>
          <CardDescription>
            Edges on every player table will be computed vs <strong>this book&apos;s</strong> no-vig price instead of the book-median. Pick the book you actually bet at.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHomeBook("")}
              className={`px-3 py-1.5 text-sm rounded border transition ${
                homeBook === "" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              None (use book median)
            </button>
            {allBooks.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setHomeBook(b)}
                className={`px-3 py-1.5 text-sm rounded border transition ${
                  homeBook === b ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {BOOK_LABELS[b] || b}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Books to exclude from consensus median</CardTitle>
          <CardDescription>
            Books you don&apos;t trust or can&apos;t access will be left out of the median calculation. If you&apos;ve set a home book above, this filter still applies when the home book has no price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allBooks.map((b) => {
              const on = excluded.has(b);
              return (
                <label
                  key={b}
                  className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition ${
                    on ? "bg-rose-500/10 border-rose-500/30 text-rose-200" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleExcluded(b)}
                    className="accent-rose-500"
                  />
                  <span className="text-sm">{BOOK_LABELS[b] || b}</span>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {tier === "elite" && (
        <Card>
          <CardHeader>
            <CardTitle>Alert delivery</CardTitle>
            <CardDescription>Where edge alerts get sent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              {(["email", "sms"] as const).map((ch) => (
                <label key={ch} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${
                  channels.has(ch) ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200" : "border-border"
                }`}>
                  <input
                    type="checkbox"
                    checked={channels.has(ch)}
                    onChange={() => toggleChannel(ch)}
                    className="accent-emerald-500"
                  />
                  <span className="text-sm capitalize">{ch}</span>
                </label>
              ))}
            </div>
            {channels.has("sms") && (
              <div>
                <Label htmlFor="sms">Mobile (E.164)</Label>
                <Input
                  id="sms"
                  type="tel"
                  placeholder="+18085551234"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  SMS sent via Twilio. Standard message rates apply (you&apos;ll pay $0 — this is on us).
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tier !== "elite" && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Elite</Badge>
              <div className="flex-1 text-sm text-muted-foreground">
                SMS alerts, custom thresholds, watchlist, sub-minute Kalshi updates, and movement alerts are part of Elite ($39/mo).{" "}
                <a href="/pricing" className="text-emerald-400 hover:underline">Upgrade →</a>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
