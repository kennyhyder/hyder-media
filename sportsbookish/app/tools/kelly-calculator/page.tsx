import Link from "next/link";
import type { Metadata } from "next";
import KellyCalcClient from "@/components/tools/KellyCalcClient";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Kelly criterion calculator — optimal bet sizing",
  description: "Free Kelly criterion bet sizing calculator. Enter your edge (true probability vs offered odds) and bankroll; get full + fractional Kelly recommendations. Maximize long-run growth without going broke.",
  alternates: { canonical: `${SITE_URL}/tools/kelly-calculator` },
};

const FAQ = [
  {
    question: "What is the Kelly criterion?",
    answer: "A formula derived by John Kelly Jr. (Bell Labs, 1956) that computes the bet size which maximizes the long-run geometric growth rate of a bankroll. Given a known edge and odds, Kelly tells you what fraction of your bankroll to risk on each bet.",
  },
  {
    question: "What's the Kelly formula?",
    answer: "f* = (bp - q) / b, where b = decimal odds minus 1, p = your estimated probability of winning, q = 1 - p. The result f* is the fraction of your bankroll to wager. Example: 60% probability at +200 odds (b=2). f* = (2 × 0.6 - 0.4) / 2 = 0.4. Bet 40% of bankroll.",
  },
  {
    question: "Should I always bet full Kelly?",
    answer: "Almost never. Full Kelly produces extremely high variance — you can routinely see 30-50% drawdowns even when you're winning long-term. Most professionals use fractional Kelly (quarter or half) which trades a small reduction in long-run growth for dramatically lower drawdowns.",
  },
  {
    question: "What if I'm wrong about my edge?",
    answer: "Kelly is extremely sensitive to errors in your probability estimate. A 5pp overestimate of your true edge can swing Kelly's recommendation from a sensible bet to a catastrophic one. This is why professionals use fractional Kelly: it builds in a margin of safety against estimation error.",
  },
  {
    question: "When does Kelly recommend zero or negative?",
    answer: "If your estimated probability times the decimal odds is less than 1, Kelly returns zero or negative — meaning no edge exists, don't bet. Negative Kelly never means \"bet the other side\"; it means \"don't bet this side.\"",
  },
];

export default function KellyCalculatorPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
          { name: "Kelly criterion calculator", url: "/tools/kelly-calculator" },
        ]),
        faqLd(FAQ),
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Kelly Criterion Calculator",
          applicationCategory: "FinanceApplication",
          description: "Compute optimal bet size given your edge and bankroll.",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/tools" className="text-sm text-muted-foreground hover:text-foreground/80">← Tools</Link>
          <div className="text-sm font-semibold">Kelly criterion calculator</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Kelly criterion calculator</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Enter your estimated true probability of winning and the price you&apos;re getting. We&apos;ll compute the optimal Kelly stake plus safer fractional Kelly recommendations.
        </p>

        <KellyCalcClient />

        <section className="mt-10 prose prose-invert prose-sm max-w-none">
          <h2 className="text-2xl font-bold">What this does</h2>
          <p>
            Kelly says: <em>your edge per unit risked, scaled by the inverse of your potential loss, equals the optimal fraction of bankroll to bet.</em>{" "}
            In math: <code>f* = (b × p - q) / b</code>, where:
          </p>
          <ul>
            <li><strong>b</strong> = decimal odds − 1 (profit per unit risked if you win)</li>
            <li><strong>p</strong> = your estimated probability of winning</li>
            <li><strong>q</strong> = 1 − p (probability of losing)</li>
          </ul>
          <p>
            Full Kelly maximizes long-run bankroll growth, but it&apos;s emotionally aggressive — a 60% bet on a 70% favorite still has a 30% chance of a catastrophic loss. Most pros use{" "}
            <strong>quarter Kelly</strong> (f*/4) or <strong>half Kelly</strong> (f*/2) which keep most of the growth while dramatically reducing drawdown variance.
          </p>
          <h2 className="text-2xl font-bold mt-6">Limitations</h2>
          <p>
            Kelly assumes you know <em>p</em> exactly. In practice you never do — your model has uncertainty.{" "}
            If you estimate p = 60% but the true probability is 55%, full Kelly will bet a size that exceeds the optimum for the actual edge, leading to long-run bankroll erosion.{" "}
            Fractional Kelly partially compensates by under-betting relative to your estimate.
          </p>
          <p>
            See also: <Link href="/learn/glossary/kelly-criterion" className="text-emerald-500 hover:underline">Kelly criterion glossary entry</Link>,{" "}
            <Link href="/learn/glossary/bankroll-management" className="text-emerald-500 hover:underline">bankroll management</Link>,{" "}
            <Link href="/learn/glossary/expected-value" className="text-emerald-500 hover:underline">expected value</Link>.
          </p>
        </section>

        <FaqSection items={FAQ} heading="Kelly criterion calculator — FAQ" />
      </main>
    </div>
  );
}
