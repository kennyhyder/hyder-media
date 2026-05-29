import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_BOOK_KEYS, ALL_EXCHANGE_KEYS, SPORTSBOOKS, EXCHANGES } from "@/lib/sportsbook-meta";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Best Legal US Sportsbooks 2026 — Live Odds Comparison | SportsBookISH";
const DESCRIPTION = "Compare DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics and Circa side-by-side with live odds. Kalshi and Polymarket overlays show where exchange pricing beats the books.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/sportsbooks` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/sportsbooks`,
    siteName: "SportsBookISH",
    type: "website",
  },
};

const HUB_FAQ = [
  {
    question: "Which legal US sportsbook has the best odds?",
    answer: "No single book leads on every market. On major-league game lines (MLB, NBA, NFL, NHL) DraftKings and FanDuel typically lead market depth; BetMGM and Caesars often lead promo-adjusted EV; Circa leads sharp-friendly limits in Nevada. SportsBookISH live-compares all of them on every event so you can pick per-bet rather than committing to one book.",
  },
  {
    question: "How does Kalshi compare to traditional sportsbooks?",
    answer: "Kalshi is a CFTC-regulated event-contracts exchange — sports markets trade as YES/NO contracts at user-set prices, not at house-set vigged odds. On major-league moneylines Kalshi mid-prices typically beat the sportsbook no-vig fair line by 2-8 percentage points; the gap widens on futures and player props.",
  },
  {
    question: "Is Polymarket legal in the US?",
    answer: "Polymarket relaunched US operations in mid-2025 as a CFTC-regulated event-contracts platform. Sports markets are growing fast. Liquidity is concentrated on major events; SportsBookISH overlays Polymarket pricing on every event where it's available.",
  },
  {
    question: "Why do you only show 7 sportsbooks?",
    answer: "SportsBookISH only names regulated US sportsbooks operating under state gaming licenses. Offshore brands (Bovada, BetOnline, MyBookie, etc.) contribute to the consensus median anonymously as 'Other' but are never named — their use in the US is unregulated and we don't promote them.",
  },
];

export default function SportsbooksHub() {
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sportsbooks", url: `${SITE_URL}/sportsbooks` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">Sportsbooks</div>
          <div />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8 space-y-10">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Legal US Sportsbooks — Live Odds Compared</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">
            Every regulated US sportsbook, plus the two big CFTC-regulated event-contract exchanges (Kalshi and Polymarket),
            in one place. Live odds refresh continuously. Compare any pair of books or any book vs Kalshi / Polymarket below.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Regulated US Sportsbooks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ALL_BOOK_KEYS.map((k) => {
              const b = SPORTSBOOKS[k];
              return (
                <Link key={k} href={`/sportsbooks/${k}`} className="block">
                  <Card className="hover:bg-muted/40 transition-colors h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>{b.name}</span>
                        <Badge variant="outline" className="text-xs">{b.market_depth}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <div className="text-muted-foreground text-xs">{b.primary_states}</div>
                      <div><span className="text-emerald-400">Edge:</span> {b.edge}</div>
                      <div className="text-xs text-muted-foreground">Review + live odds →</div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Event-Contract Exchanges</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ALL_EXCHANGE_KEYS.map((k) => {
              const e = EXCHANGES[k];
              return (
                <Card key={k} className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{e.name}</span>
                      <Badge variant="outline" className="text-xs">Exchange</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <div className="text-muted-foreground text-xs">{e.primary_states}</div>
                    <div><span className="text-emerald-400">Edge:</span> {e.edge}</div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {ALL_BOOK_KEYS.map((bk) => (
                        <Link key={bk} href={`/sportsbooks/${k}-vs-${bk}`} className="text-xs text-amber-400 hover:underline">
                          vs {SPORTSBOOKS[bk].name}
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-4">Head-to-Head Comparisons</h2>
          <p className="text-sm text-muted-foreground mb-4">Every pair of regulated US sportsbooks compared on live odds.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {ALL_BOOK_KEYS.flatMap((a, i) =>
              ALL_BOOK_KEYS.slice(i + 1).map((b) => (
                <Link key={`${a}-${b}`} href={`/sportsbooks/${a}-vs-${b}`}
                  className="block p-3 rounded-md border border-border/40 hover:bg-muted/40 text-sm">
                  {SPORTSBOOKS[a].name} vs {SPORTSBOOKS[b].name} →
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {HUB_FAQ.map((f, i) => (
                <div key={i} className="p-4">
                  <div className="font-semibold mb-1">{f.question}</div>
                  <div className="text-sm text-muted-foreground">{f.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
