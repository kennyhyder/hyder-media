import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { JsonLd, breadcrumbLd, itemListLd, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Compare Kalshi to DraftKings, FanDuel, BetMGM & More",
  description:
    "Side-by-side breakdowns of Kalshi event-contract prices vs every major US sportsbook. See where Kalshi is cheaper, where the books offer better lines, and how to find consistent edges.",
  alternates: { canonical: `${SITE_URL}/compare` },
};

const BOOKS = [
  { slug: "draftkings", name: "DraftKings", emoji: "🟢", oneline: "America's largest legal sportsbook — broad market coverage, sharp pricing on majors." },
  { slug: "fanduel", name: "FanDuel", emoji: "🔵", oneline: "Daily-fantasy giant turned sportsbook — slight favorites bias on primetime games." },
  { slug: "betmgm", name: "BetMGM", emoji: "🟡", oneline: "Vegas heritage, frequent promo pricing — often the soft side of the consensus." },
  { slug: "caesars", name: "Caesars", emoji: "🟣", oneline: "Massive parlay book — moneylines move slower than the market." },
  { slug: "betrivers", name: "BetRivers", emoji: "🔴", oneline: "Regional book — best-line opportunities especially on baseball." },
  { slug: "fanatics", name: "Fanatics", emoji: "⚫", oneline: "Newest entrant, often boosts on home-team markets." },
];

export default function ComparePage() {
  const items = BOOKS.map((b) => ({ name: `Kalshi vs ${b.name}`, url: `/compare/kalshi-vs-${b.slug}` }));
  const ld = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
    ]),
    itemListLd("Kalshi vs sportsbook comparisons", items),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <JsonLd data={ld} />
      <main id="main" className="container mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Kalshi vs the sportsbooks</h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-3xl">
          Kalshi is a CFTC-regulated event-contract exchange — its prices float on supply and demand, with no house edge baked in. US sportsbooks set their own lines and bake in vigorish (the &ldquo;vig&rdquo;). After de-vigging book odds, the two markets often disagree by 1–10%+, especially on smaller games and futures.
        </p>

        <h2 className="text-2xl font-bold mb-4">Side-by-side comparisons</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
          {BOOKS.map((b) => (
            <Link
              key={b.slug}
              href={`/compare/kalshi-vs-${b.slug}`}
              className="block group focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
              aria-label={`Kalshi vs ${b.name} comparison`}
            >
              <Card className="hover:border-emerald-500/40 transition-colors">
                <CardContent className="p-5 flex items-start gap-4">
                  <span className="text-4xl shrink-0" aria-hidden="true">{b.emoji}</span>
                  <div className="flex-1">
                    <div className="font-semibold text-lg">Kalshi vs {b.name}</div>
                    <div className="text-sm text-muted-foreground mt-1">{b.oneline}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground mt-2" aria-hidden="true" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <section className="prose prose-invert max-w-none">
          <h2 className="text-2xl font-bold mb-3">Why compare Kalshi to sportsbooks?</h2>
          <p className="text-muted-foreground leading-relaxed">
            Kalshi&apos;s peer-to-peer pricing model creates legitimate edges when its market disagrees with the consensus across major US sportsbooks. A 3% edge on a moneyline is meaningful; a 5%+ edge is rare and usually profitable over time. SportsBookISH refreshes every Kalshi market against 11+ sportsbooks every 5 minutes so you can spot these gaps in real time.
          </p>
          <h2 className="text-2xl font-bold mt-8 mb-3">What about Pinnacle or Bookmaker?</h2>
          <p className="text-muted-foreground leading-relaxed">
            We currently track US-licensed books available via The Odds API. Pinnacle / Bookmaker are offshore and not in the dataset. We use the median across the books we do track as the &ldquo;sharp&rdquo; reference — it&apos;s less precise than a Pinnacle line but available legally and updates more reliably for the markets Kalshi covers.
          </p>
          <h2 className="text-2xl font-bold mt-8 mb-3">How to interpret &ldquo;edge&rdquo;</h2>
          <p className="text-muted-foreground leading-relaxed">
            We compute the de-vigged implied probability for each side at each book, take the median across books, then subtract Kalshi&apos;s implied probability. Positive numbers mean Kalshi is pricing the outcome cheaper than the books — a buy edge. Negative means Kalshi is overpriced. Edges under 1.5% are usually noise; 3%+ is actionable; 5%+ is rare and worth investigating.
          </p>
        </section>

        <div className="mt-12 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <h2 className="text-xl font-bold mb-2">Ready to see live edges?</h2>
          <p className="text-sm text-muted-foreground mb-4">No card required.</p>
          <Link
            href="/sports"
            className="inline-flex items-center gap-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
          >
            Browse live odds <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
