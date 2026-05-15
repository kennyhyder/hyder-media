import Link from "next/link";
import type { Metadata } from "next";
import OddsConverterClient from "@/components/tools/OddsConverterClient";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Odds converter — American, decimal, fractional, implied probability",
  description: "Free betting odds converter. Convert between American (-150), decimal (1.67), fractional (2/3), and implied probability (60%) in one click. Used by sports bettors worldwide.",
  alternates: { canonical: `${SITE_URL}/tools/odds-converter` },
};

const FAQ = [
  {
    question: "How do you convert American odds to decimal?",
    answer: "Positive American odds: decimal = (american / 100) + 1. So +200 → 3.00. Negative American odds: decimal = (100 / |american|) + 1. So -150 → 1.67.",
  },
  {
    question: "How do you convert American odds to implied probability?",
    answer: "Positive American: p = 100 / (american + 100). +200 → 33.3%. Negative American: p = |american| / (|american| + 100). -150 → 60%. This is the probability the price implies the outcome has, before vig is removed.",
  },
  {
    question: "What's the difference between American, decimal, and fractional?",
    answer: "Same odds, different display. American is standard in the US. Decimal is standard in Europe and easier for math (just multiply by stake to get total return including stake). Fractional (5/2, 1/3) is traditional in the UK. All convert losslessly.",
  },
  {
    question: "Why do most pros prefer decimal odds?",
    answer: "Decimal odds make expected value and Kelly criterion math trivial — multiply stake by decimal odds to get gross return, subtract stake for profit. American odds require branching logic for favorites vs underdogs. For programmatic betting, decimal is the universal format.",
  },
];

export default function OddsConverterPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Tools", url: "/tools" },
          { name: "Odds converter", url: "/tools/odds-converter" },
        ]),
        faqLd(FAQ),
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Odds Converter",
          applicationCategory: "FinanceApplication",
          description: "Convert between American, decimal, fractional, and implied probability betting odds.",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/tools" className="text-sm text-muted-foreground hover:text-foreground/80">← Tools</Link>
          <div className="text-sm font-semibold">Odds converter</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Odds converter</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Enter odds in any format — American, decimal, fractional, or implied probability — and we&apos;ll show all four equivalents instantly.
        </p>

        <OddsConverterClient />

        <section className="mt-10 prose prose-invert prose-sm max-w-none">
          <h2 className="text-2xl font-bold">Common conversions</h2>
          <table className="w-full text-sm border-collapse border border-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="border border-border px-3 py-2 text-left">American</th>
                <th className="border border-border px-3 py-2 text-left">Decimal</th>
                <th className="border border-border px-3 py-2 text-left">Fractional</th>
                <th className="border border-border px-3 py-2 text-left">Implied prob.</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {[
                ["-300", "1.33", "1/3", "75.00%"],
                ["-200", "1.50", "1/2", "66.67%"],
                ["-150", "1.67", "2/3", "60.00%"],
                ["-110", "1.91", "10/11", "52.38%"],
                ["+100", "2.00", "1/1", "50.00%"],
                ["+110", "2.10", "11/10", "47.62%"],
                ["+150", "2.50", "3/2", "40.00%"],
                ["+200", "3.00", "2/1", "33.33%"],
                ["+500", "6.00", "5/1", "16.67%"],
                ["+1000", "11.00", "10/1", "9.09%"],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, j) => (
                    <td key={j} className="border border-border px-3 py-1.5">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            See also: <Link href="/learn/glossary/implied-probability" className="text-emerald-500 hover:underline">implied probability glossary entry</Link>.
          </p>
        </section>

        <FaqSection items={FAQ} heading="Odds converter — FAQ" />
      </main>
    </div>
  );
}
