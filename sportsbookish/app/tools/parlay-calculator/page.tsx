import Link from "next/link";
import type { Metadata } from "next";
import ParlayCalcClient from "@/components/tools/ParlayCalcClient";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Parlay calculator — combine bets and see true payout vs fair",
  description: "Free parlay calculator. Enter 2-12 legs of American odds and your stake; we'll show the parlay payout, the fair-value payout, and exactly how much vig the parlay charges you.",
  alternates: { canonical: `${SITE_URL}/tools/parlay-calculator` },
};

const FAQ = [
  {
    question: "What is a parlay?",
    answer: "A parlay combines two or more individual bets into a single wager. All selections (legs) must win for the parlay to pay out. If even one leg loses, the entire parlay loses.",
  },
  {
    question: "How is a parlay payout calculated?",
    answer: "Multiply the decimal odds of each leg, then multiply that product by your stake to get the total return (including stake). Example: three legs at decimal 1.91 each → 1.91^3 = 6.97. A $10 parlay pays $69.70 ($59.70 profit).",
  },
  {
    question: "Are parlays +EV?",
    answer: "Almost never. Each leg has its own vig built in (typically 4-5% for game lines, 8-12% for props). The parlay compounds those vigs, so a 4-leg parlay of -110 bets has approximately 16-20% total vig vs ~4% on a single bet. Books love parlays because the math overwhelmingly favors them.",
  },
  {
    question: "When can a parlay be +EV?",
    answer: "Correlated parlays where the legs are positively correlated AND the book doesn't price the correlation correctly. Same-game parlays of 'Team X wins big' + 'Total over' can be value plays when offensive shootouts are likely. Sharp books now price most correlations explicitly, so this edge is mostly gone in 2026.",
  },
  {
    question: "What's the difference between parlay and same-game parlay?",
    answer: "A traditional parlay combines independent events from different games. A same-game parlay combines outcomes from one game (Patrick Mahomes over 275 yards + Chiefs to win + Total over). Books price same-game parlays with correlation adjustments, usually making them slightly worse value than uncorrelated parlays.",
  },
];

export default function ParlayCalculatorPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
          { name: "Parlay calculator", url: "/tools/parlay-calculator" },
        ]),
        faqLd(FAQ),
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Parlay Calculator",
          applicationCategory: "FinanceApplication",
          description: "Compute parlay payout, fair-value comparison, and effective vig.",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/tools" className="text-sm text-muted-foreground hover:text-foreground/80">← Tools</Link>
          <div className="text-sm font-semibold">Parlay calculator</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Parlay calculator</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Enter 2-12 legs of American odds + your stake. We&apos;ll compute the actual parlay payout, the fair (no-vig) payout for comparison, and exactly how much you&apos;re paying away in compounded vig.
        </p>

        <ParlayCalcClient />

        <section className="mt-10 prose prose-invert prose-sm max-w-none">
          <h2 className="text-2xl font-bold">The math</h2>
          <p>For each leg, convert American odds to decimal and to implied probability. Then:</p>
          <pre className="bg-card border border-border/60 rounded p-4 text-sm">
{`Parlay decimal odds = leg1_decimal × leg2_decimal × ... × legN_decimal
Parlay profit = stake × (parlay_decimal − 1)
Implied prob (raw) = 1 / parlay_decimal

For "fair" comparison:
  no_vig_per_leg = leg_implied / (leg_implied + opposite_side_implied)
  ... but we only have one side. Simpler: assume each -110 leg de-vigs
  to ~50% (the book median for game lines), and apply that to each leg.`}
          </pre>
          <p>
            The fair-value payout shows what the parlay <em>would</em> pay if the book charged zero vig. The difference between the book&apos;s payout and the fair payout is the parlay&apos;s effective cost to you, expressed as a percentage of stake.
          </p>
          <p>
            See <Link href="/learn/glossary/parlay" className="text-emerald-500 hover:underline">parlay glossary entry</Link> for more on when (rarely) parlays are +EV.
          </p>
        </section>

        <FaqSection items={FAQ} heading="Parlay calculator — FAQ" />
      </main>
    </div>
  );
}
