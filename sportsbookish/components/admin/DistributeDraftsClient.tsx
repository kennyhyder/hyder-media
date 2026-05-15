"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

interface Draft {
  kind: "movement";
  league: string;
  event_title: string;
  contestant: string;
  delta_pct: number;       // 0.05 = +5pp
  prob_now: number;
  url: string;
}

interface Variant {
  channel: "X / Bluesky / Threads" | "Reddit title" | "Reddit body";
  text: string;
  charLimit?: number;
}

function fmtPct(n: number, signed = false): string {
  const v = (n * 100).toFixed(1);
  return signed && n > 0 ? `+${v}%` : `${v}%`;
}

function buildVariants(d: Draft): Variant[] {
  const direction = d.delta_pct > 0 ? "up" : "down";
  const emoji = d.delta_pct > 0 ? "📈" : "📉";
  const pctSigned = fmtPct(d.delta_pct, true);
  const probNow = fmtPct(d.prob_now);
  const leagueUpper = d.league.toUpperCase();

  return [
    {
      channel: "X / Bluesky / Threads",
      charLimit: 280,
      text: `${emoji} Kalshi ${leagueUpper} move

${d.contestant} ${direction} ${pctSigned} in the last 24h on ${d.event_title}

Now trading at ${probNow}

Live odds + edge vs books: ${d.url}

#${leagueUpper} #Kalshi #SportsBetting`,
    },
    {
      channel: "Reddit title",
      charLimit: 300,
      text: `[Kalshi ${leagueUpper}] ${d.contestant} ${direction} ${pctSigned} on ${d.event_title} (now ${probNow})`,
    },
    {
      channel: "Reddit body",
      text: `Kalshi's price for **${d.contestant}** on ${d.event_title} moved ${pctSigned} in the last 24 hours. Currently trading at ${probNow} implied probability.

[Live odds + sportsbook comparison →](${d.url})

(I track Kalshi vs DraftKings/FanDuel/BetMGM/Caesars/8+ others in real time at sportsbookish.com. Free to view; no signup required.)`,
    },
  ];
}

export default function DistributeDraftsClient({ drafts }: { drafts: Draft[] }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  return (
    <div className="space-y-6">
      {drafts.map((d, i) => {
        const variants = buildVariants(d);
        return (
          <Card key={`${d.contestant}-${i}`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{d.league.toUpperCase()} · move</div>
                  <h3 className="text-lg font-semibold">{d.contestant} {fmtPct(d.delta_pct, true)}</h3>
                  <div className="text-xs text-muted-foreground">{d.event_title}</div>
                </div>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-500 hover:underline whitespace-nowrap">
                  View event →
                </a>
              </div>

              <div className="space-y-3">
                {variants.map((v) => {
                  const key = `${i}-${v.channel}`;
                  const isCopied = copiedKey === key;
                  const overLimit = v.charLimit ? v.text.length > v.charLimit : false;
                  return (
                    <div key={v.channel} className="rounded border border-border bg-background/40">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground">{v.channel}</span>
                        <div className="flex items-center gap-2">
                          {v.charLimit && (
                            <span className={`text-[10px] tabular-nums ${overLimit ? "text-rose-500" : "text-muted-foreground"}`}>
                              {v.text.length} / {v.charLimit}
                            </span>
                          )}
                          <Button size="sm" variant="outline" onClick={() => copy(key, v.text)} className="h-7">
                            {isCopied ? <><Check className="h-3 w-3 mr-1" /> Copied</> : <><Copy className="h-3 w-3 mr-1" /> Copy</>}
                          </Button>
                        </div>
                      </div>
                      <pre className="text-xs p-3 whitespace-pre-wrap font-sans leading-relaxed">{v.text}</pre>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
