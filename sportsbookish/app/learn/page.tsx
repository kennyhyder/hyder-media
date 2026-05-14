import Link from "next/link";
import type { Metadata } from "next";
import MarketingNav from "@/components/nav/MarketingNav";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, BookOpen } from "lucide-react";
import { JsonLd, breadcrumbLd, itemListLd, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Learn — Kalshi Odds, No-Vig Math, Sports Edge Betting",
  description:
    "Long-form explainers on Kalshi event-contract odds, de-vigging sportsbook prices, finding edges across NBA, MLB, NHL, EPL, MLS and PGA Tour markets.",
  alternates: { canonical: `${SITE_URL}/learn` },
};

const TOPICS = [
  {
    slug: "what-are-kalshi-odds",
    title: "What are Kalshi odds?",
    excerpt: "A primer on Kalshi event contracts — how prices form, why they differ from sportsbook lines, and how to read them as probabilities.",
    minutes: 6,
  },
  {
    slug: "no-vig-explained",
    title: "What is 'no-vig' and how is it calculated?",
    excerpt: "Sportsbooks charge a margin (the 'vig'). Here's how to strip it out and get the true implied probability of each side.",
    minutes: 4,
  },
  {
    slug: "kalshi-edge-betting",
    title: "How to spot edges between Kalshi and sportsbooks",
    excerpt: "Buy edges, sell edges, best-book selection, when 3% is real and when 5% is a data anomaly. A practical guide.",
    minutes: 8,
  },
  {
    slug: "kalshi-vs-prediction-markets",
    title: "Kalshi vs Polymarket vs PredictIt",
    excerpt: "How the major US prediction markets compare on liquidity, regulation, fees, and sports coverage.",
    minutes: 5,
  },
];

export default function LearnPage() {
  const items = TOPICS.map((t) => ({ name: t.title, url: `/learn/${t.slug}` }));
  const ld = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Learn", url: "/learn" },
    ]),
    itemListLd("SportsBookISH learning resources", items),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <JsonLd data={ld} />
      <MarketingNav />
      <main id="main" className="container mx-auto max-w-5xl px-4 py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>Learn</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Master the math behind Kalshi vs the books</h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-3xl">
          Short, practical guides on event-contract odds, no-vig calculations, and finding consistent edges. Written for sports bettors who want to understand <em>why</em> Kalshi prices differ from DraftKings and FanDuel, not just <em>that</em> they do.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TOPICS.map((t) => (
            <Link
              key={t.slug}
              href={`/learn/${t.slug}`}
              className="block group focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
              aria-label={t.title}
            >
              <Card className="hover:border-emerald-500/40 transition-colors h-full">
                <CardContent className="p-5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t.minutes} min read</div>
                  <h2 className="font-semibold text-lg mb-2">{t.title}</h2>
                  <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{t.excerpt}</p>
                  <span className="text-emerald-500 text-sm inline-flex items-center gap-1">
                    Read more <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
