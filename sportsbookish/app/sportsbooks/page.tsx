import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_BOOK_KEYS, ALL_EXCHANGE_KEYS, SPORTSBOOKS, EXCHANGES } from "@/lib/sportsbook-meta";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { BRAND_PROFILES, brandOrganizationLd } from "@/lib/brand-profiles";
import TradingCtaRow from "@/components/TradingCtaRow";

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
    answer: "No single book leads on every market. On major-league game lines (MLB, NBA, NFL, NHL) DraftKings and FanDuel typically lead market depth; BetMGM and Caesars often lead promo-adjusted EV; Circa leads sharp-friendly limits in Nevada with no winner limiting. SportsBookISH live-compares all of them on every event so you can pick per-bet rather than committing to one book.",
  },
  {
    question: "How does Kalshi compare to traditional sportsbooks?",
    answer: "Kalshi is a CFTC-regulated event-contracts exchange (legal in all 50 US states) — sports markets trade as YES/NO contracts at user-set prices, not at house-set vigged odds. On major-league moneylines Kalshi mid-prices typically beat the sportsbook no-vig fair line by 2-8 percentage points; the gap widens on futures and player props. Kalshi also doesn't limit winning users the way DraftKings/FanDuel do.",
  },
  {
    question: "Is Polymarket legal in the US?",
    answer: "Officially, no. Polymarket settled with the CFTC in January 2022 and geo-blocks US users, operating internationally under its Cayman Islands entity. The platform remains the largest prediction market by global volume (~$8B in 2024), but US users are excluded. For legal US event-contract trading, use Kalshi.",
  },
  {
    question: "Why do you only show 8 sportsbooks?",
    answer: "SportsBookISH only names regulated US sportsbooks operating under state gaming licenses. Offshore brands (Bovada, BetOnline, MyBookie, etc.) contribute to the consensus median anonymously as 'Other' but are never named — their use in the US is unregulated and Vault Network / regulated affiliate programs explicitly forbid co-promotion. We track 7 US sportsbooks (DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, Circa) plus Kalshi and Polymarket exchanges.",
  },
  {
    question: "Which US sportsbooks accept the highest limits?",
    answer: "Circa Sports — by published policy, Circa does not limit winning bettors and routinely accepts $25k+ on NFL sides. DraftKings, FanDuel, BetMGM, and Caesars all limit sharp users (typically after $5k–$10k in net winnings over a season). Kalshi has no per-account limits — only orderbook depth constrains size.",
  },
  {
    question: "Which sportsbook has the best new-user promo?",
    answer: "Promos rotate constantly and vary by state. As of late 2025: Caesars offers a $1,000 first-bet match (refund as bonus bets if your first bet loses). DraftKings and FanDuel both run \"bet $5, get $200 in bonus bets\" promos in most states. Fanatics offers \"$100 in bonus bets per day for 10 days\" for new users. BetMGM runs a $1,500 first-bet offer in many states. Always check directly — terms change weekly.",
  },
  {
    question: "What's the difference between an event-contract exchange and a sportsbook?",
    answer: "A sportsbook (DraftKings, FanDuel, etc.) sets its own prices and takes the opposite side of every bet — they make money on the vig (built-in margin, typically 4–5% on moneylines). An event-contract exchange (Kalshi, Polymarket) is a peer-to-peer marketplace where users buy/sell YES/NO contracts against each other; the platform doesn't take a position. Result: exchange pricing is structurally cheaper (no vig, just bid/ask spread) but liquidity can be thinner on niche markets.",
  },
];

export default function SportsbooksHub() {
  // Emit Organization JSON-LD for every brand on the hub so AI overviews
  // and structured-data crawlers can index the whole roster from one URL.
  const brandLds = Object.values(BRAND_PROFILES).map((p) => brandOrganizationLd(p));

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sportsbooks", url: `${SITE_URL}/sportsbooks` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />
      <JsonLd data={brandLds} />
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: TITLE,
        description: DESCRIPTION,
        author: { "@type": "Person", name: "Kenny Hyder", url: `${SITE_URL}/about/kenny-hyder` },
        publisher: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
        mainEntityOfPage: `${SITE_URL}/sportsbooks`,
        datePublished: "2026-05-12",
        dateModified: new Date().toISOString().slice(0, 10),
      }} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">Sportsbooks</div>
          <div />
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-8 space-y-10">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Legal US Sportsbooks &amp; Prediction Markets — Live Odds Compared</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">
            Every regulated US sportsbook plus the two largest event-contract / prediction markets (Kalshi and Polymarket), in one place. Live odds refresh continuously. Below: brand-at-a-glance table covering founding, regulator, scale, funding and valuation, plus individual review pages and head-to-head comparisons.
          </p>
        </section>

        {/* Universal Kalshi + Polymarket affiliate row above the brand cards. */}
        <section>
          <TradingCtaRow campaign="sportsbooks-hub" />
        </section>

        {/* Brand-at-a-glance table — every profile in the registry as a single
            scannable matrix. Best surface for AI overviews + Perplexity to
            extract structured facts about the whole roster. */}
        <section>
          <h2 className="text-xl font-bold mb-1">Brands at a glance</h2>
          <p className="text-sm text-muted-foreground mb-4">Founded year, regulator, scale, funding, and valuation across every covered brand. All figures best-effort as of 2025-Q4 from public filings, official communications, and third-party trackers.</p>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="text-left px-3 py-2">Brand</th>
                  <th scope="col" className="text-left px-3 py-2">Category</th>
                  <th scope="col" className="text-left px-3 py-2">Founded</th>
                  <th scope="col" className="text-left px-3 py-2">Regulator</th>
                  <th scope="col" className="text-left px-3 py-2">Monthly volume</th>
                  <th scope="col" className="text-left px-3 py-2">Total raised</th>
                  <th scope="col" className="text-left px-3 py-2">Valuation</th>
                  <th scope="col" className="text-left px-3 py-2">Review</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(BRAND_PROFILES).map((p) => (
                  <tr key={p.slug} className="border-t border-border/40 align-top">
                    <th scope="row" className="text-left px-3 py-2 font-medium whitespace-nowrap">
                      <span aria-hidden="true">{p.emoji} </span>{p.name}
                    </th>
                    <td className="px-3 py-2 text-muted-foreground capitalize">{p.category.replace("-", " ")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.founded}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.regulator}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.monthlyVolumeUsd || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.totalRaisedUsd || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.valuationUsd || "—"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/sportsbooks/${p.slug}`} className="text-emerald-500 hover:underline text-xs whitespace-nowrap">Full review →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
