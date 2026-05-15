import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Calculator, Percent, Repeat, TrendingUp, Layers } from "lucide-react";
import { JsonLd, breadcrumbLd, itemListLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Free sports betting calculators — no-vig, Kelly, odds converter",
  description: "Free interactive calculators for sports bettors: no-vig probability stripper, Kelly criterion bet sizer, American↔decimal odds converter. No signup required.",
  alternates: { canonical: `${SITE_URL}/tools` },
};

const TOOLS = [
  {
    slug: "no-vig-calculator",
    title: "No-vig calculator",
    excerpt: "Strip the vig out of sportsbook prices to see the true implied probability of each side. The standard reference for cross-book and Kalshi comparisons.",
    icon: Percent,
  },
  {
    slug: "kelly-calculator",
    title: "Kelly criterion calculator",
    excerpt: "Compute optimal bet size given your edge, the price, and your bankroll. Full Kelly + fractional (¼, ½) Kelly recommendations.",
    icon: TrendingUp,
  },
  {
    slug: "odds-converter",
    title: "Odds converter",
    excerpt: "Convert between American (-150), decimal (1.67), fractional (2/3), and implied probability (60%) instantly. The Rosetta Stone for betting math.",
    icon: Repeat,
  },
  {
    slug: "parlay-calculator",
    title: "Parlay calculator",
    excerpt: "Compute parlay payout and see the compounded vig cost. 2-12 legs, real-time fair-value comparison so you know exactly what the book is charging you.",
    icon: Layers,
  },
];

export default function ToolsIndex() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
        ]),
        itemListLd("SportsBookISH calculators", TOOLS.map((t) => ({ name: t.title, url: `/tools/${t.slug}` }))),
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">Free tools</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-5xl px-4 py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <Calculator className="h-4 w-4" aria-hidden="true" />
          <span>Tools</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">Free sports betting calculators</h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-3xl">
          Pure-math utilities that work without an account. Stripped-vig probabilities, Kelly bet sizing, and odds conversion — the same math powering our live edge tables across NBA, NFL, MLB, NHL, EPL, MLS, UCL, and PGA Tour.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.slug} href={`/tools/${t.slug}`} className="block group focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
                <Card className="hover:border-emerald-500/40 transition-colors h-full">
                  <CardContent className="p-5">
                    <Icon className="h-6 w-6 text-emerald-500 mb-3" aria-hidden="true" />
                    <h2 className="font-semibold text-lg mb-2">{t.title}</h2>
                    <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{t.excerpt}</p>
                    <span className="text-emerald-500 text-sm inline-flex items-center gap-1">
                      Open tool <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 text-xs text-muted-foreground border-t border-border/40 pt-6 max-w-3xl">
          <p>
            Need definitions? See the <Link href="/learn/glossary" className="text-emerald-500 hover:underline">sports betting glossary</Link> for plain-English explanations of every term used in these calculators.
          </p>
        </div>
      </main>
    </div>
  );
}
