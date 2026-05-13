"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { alertMatchesRule, type AlertRule } from "@/lib/alert-rules";

export interface FeedAlert {
  source: "golf" | "sports";
  id: string;
  sport: string | null;
  league: string;
  fired_at: string;
  alert_type: string;
  direction: string;
  delta: number;
  probability: number;
  reference: number;
  reference_label: string;
  title: string;
  subtitle: string;
  book_count: number;
  link: string;
}

const SPORT_ICON: Record<string, string> = { golf: "⛳", pga: "⛳", nba: "🏀", mlb: "⚾", nhl: "🏒", epl: "⚽", mls: "⚽" };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Map a feed alert to the shape the rule matcher expects
function asMatchInput(a: FeedAlert) {
  // direction normalization: feed alerts use 'up'/'down' for movements,
  // 'buy'/'sell' for golf edge crossings
  const alertType =
    a.source === "golf" && a.direction === "buy" ? "edge_buy" :
    a.source === "golf" && a.direction === "sell" ? "edge_sell" :
    "movement";
  return {
    source: a.source,
    sport: a.sport,
    league: a.league,
    alert_type: alertType,
    direction: a.direction,
    delta: a.delta,
    probability: a.probability,
  };
}

interface Props {
  alerts: FeedAlert[];
  rules: AlertRule[];
  filterByRules: boolean;
}

export default function AlertsFeed({ alerts, rules, filterByRules }: Props) {
  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = alerts;
    if (filterByRules) {
      list = list.filter((a) => {
        const input = asMatchInput(a);
        return enabledRules.some((r) => alertMatchesRule(input, r));
      });
    }
    if (leagueFilter !== "all") {
      list = list.filter((a) => a.league === leagueFilter);
    }
    return list;
  }, [alerts, enabledRules, filterByRules, leagueFilter]);

  const leagues = Array.from(new Set(alerts.map((a) => a.league))).sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-muted-foreground">League:</span>
        <button onClick={() => setLeagueFilter("all")} className={`px-2 py-1 rounded ${leagueFilter === "all" ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:bg-muted/50"}`}>All ({alerts.length})</button>
        {leagues.map((l) => (
          <button key={l} onClick={() => setLeagueFilter(l)} className={`px-2 py-1 rounded ${leagueFilter === l ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40" : "text-muted-foreground hover:bg-muted/50"}`}>
            {SPORT_ICON[l] || ""} {l.toUpperCase()} ({alerts.filter((a) => a.league === l).length})
          </button>
        ))}
        <span className="ml-auto text-muted-foreground/70">
          {filterByRules ? `Matching your ${enabledRules.length} enabled rule${enabledRules.length === 1 ? "" : "s"}` : "All fired alerts (unfiltered)"} · showing {filtered.length}
        </span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">{filterByRules ? "Alerts matching your rules" : "All fired alerts"}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Sport</th>
                <th className="px-3 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-center">Dir</th>
                <th className="px-3 py-2 text-right">Δ</th>
                <th className="px-3 py-2 text-right text-amber-500">Kalshi</th>
                <th className="px-3 py-2 text-right">Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((a) => {
                const isBuy = a.direction === "buy" || a.direction === "up";
                return (
                  <tr key={`${a.source}-${a.id}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(a.fired_at)}</td>
                    <td className="px-3 py-2">{SPORT_ICON[a.sport || ""] || SPORT_ICON[a.league] || "🎯"} <span className="text-xs uppercase">{a.league}</span></td>
                    <td className="px-3 py-2">
                      <Link href={a.link} className="hover:text-emerald-500 hover:underline">{a.title}</Link>
                      <div className="text-xs text-muted-foreground">{a.subtitle}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{a.alert_type}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${isBuy ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>{a.direction}</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${isBuy ? "text-emerald-500" : "text-rose-500"}`}>
                      {a.delta >= 0 ? "+" : ""}{(a.delta * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-500">{(a.probability * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{(a.reference * 100).toFixed(1)}% <span className="text-[9px]">({a.reference_label})</span></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  {filterByRules
                    ? "No alerts matched your rules in the last 72h. Loosen the threshold or remove sport filters."
                    : "No alerts fired in the last 72h — engine scans every 5 min."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
