import Link from "next/link";
import type { Metadata } from "next";
import NoVigCalcClient from "@/components/tools/NoVigCalcClient";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "No-vig calculator — strip the vig from sportsbook odds",
  description: "Free interactive no-vig calculator. Enter two American odds (e.g. -110 / -110), get the true probability after the bookmaker's margin is removed. The standard reference for comparing prices across sportsbooks and Kalshi.",
  alternates: { canonical: `${SITE_URL}/tools/no-vig-calculator` },
};

const FAQ = [
  {
    question: "What is the vig (vigorish)?",
    answer: "The vig is the bookmaker's margin baked into the odds. When DraftKings lists Lakers -110 / Celtics -110, the implied probabilities are 52.4% + 52.4% = 104.8%. The 4.8% above 100% is the vig — the book's profit margin if action balances on both sides.",
  },
  {
    question: "How is no-vig probability calculated?",
    answer: "For a two-outcome market: divide each side's raw implied probability by the sum of all sides' raw implied probabilities. Lakers raw = 52.4% / 104.8% = 50.0%. The result sums to exactly 100%, with the vig stripped out.",
  },
  {
    question: "Why does no-vig matter when comparing to Kalshi?",
    answer: "Kalshi prices are pure exchange prices — no built-in vig (just a small per-contract trading fee). Comparing Kalshi's implied probability directly to a sportsbook's raw implied probability would penalize Kalshi for not having the book's hidden margin. No-vig levels the playing field so you can spot real edges.",
  },
  {
    question: "What if my market has more than two outcomes?",
    answer: "The same multiplicative normalization works for any number of outcomes. For a 6-way market (e.g., NFL MVP with 6 contestants), sum all raw implied probabilities and divide each by the total. For outright futures with very wide fields, this method is still standard but vig can run 15-25%.",
  },
  {
    question: "Are there other de-vigging methods?",
    answer: "Yes — the multiplicative method is the standard, but Pinnacle's 'power' method and additive normalization both exist. Pinnacle's method is more accurate at the extremes (very heavy favorites/longshots) but the multiplicative method is the industry default and what sportsbook APIs return when they expose de-vigged numbers.",
  },
];

export default function NoVigCalculatorPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
          { name: "No-vig calculator", url: "/tools/no-vig-calculator" },
        ]),
        faqLd(FAQ),
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "No-Vig Calculator",
          applicationCategory: "FinanceApplication",
          description: "Strip the vig from sportsbook odds to compute true implied probability.",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/tools" className="text-sm text-muted-foreground hover:text-foreground/80">← Tools</Link>
          <div className="text-sm font-semibold">No-vig calculator</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">No-vig calculator</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Enter the American odds for both sides of a market to see the true implied probability after the bookmaker&apos;s margin (vig) is removed.
        </p>

        <NoVigCalcClient />

        <section className="mt-10 prose prose-invert prose-sm max-w-none">
          <h2 className="text-2xl font-bold">What this does</h2>
          <p>
            When a sportsbook lists Lakers <strong>-110</strong> and Celtics <strong>-110</strong>, the raw implied probabilities don&apos;t sum to 100% — they sum to about 104.8%.
            The extra 4.8% is the book&apos;s margin (the &ldquo;vig&rdquo;). De-vigging strips that margin to produce probabilities that sum to exactly 100%, giving you a fair-price reference.
          </p>
          <p>
            This is the standard tool for comparing prices across sportsbooks, against{" "}
            <Link href="/" className="text-emerald-500 hover:underline">Kalshi&apos;s exchange odds</Link>, or against your own model. Without de-vigging, you&apos;d systematically underestimate the value of every side because the book&apos;s margin is baked into both prices.
          </p>
          <h2 className="text-2xl font-bold mt-6">The math</h2>
          <p>
            For two outcomes A and B with raw implied probabilities p<sub>A</sub> and p<sub>B</sub>:
          </p>
          <pre className="bg-card border border-border/60 rounded p-4 text-sm">
{`p_A_novig = p_A / (p_A + p_B)
p_B_novig = p_B / (p_A + p_B)`}
          </pre>
          <p>This is called <strong>multiplicative normalization</strong>. For markets with more than two outcomes (e.g. futures), same logic applies — divide each raw implied by the sum of all of them.</p>
          <h2 className="text-2xl font-bold mt-6">When does vig matter most?</h2>
          <p>
            Vig is highest on outright futures (15-25%), props (8-12%), and parlays (compounds per leg). On a typical NFL or NBA game line, vig is 4-5%. The higher the vig, the more important it is to de-vig before comparing.
          </p>
          <p>
            For a deeper dive, see the <Link href="/learn/glossary/vig" className="text-emerald-500 hover:underline">vig glossary entry</Link> and{" "}
            <Link href="/learn/glossary/no-vig" className="text-emerald-500 hover:underline">no-vig glossary entry</Link>.
          </p>
        </section>

        <FaqSection items={FAQ} heading="No-vig calculator — FAQ" />
      </main>
    </div>
  );
}
