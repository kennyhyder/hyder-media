import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_BOOK_KEYS, SPORTSBOOKS } from "@/lib/sportsbook-meta";
import { affiliateUrl } from "@/lib/affiliates";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Best Sportsbook Promos & Welcome Offers 2026 | SportsBookISH";
const DESC = "Every regulated US sportsbook's current welcome offer side-by-side with expected-value conversion math. DraftKings, FanDuel, BetMGM, Caesars, BetRivers, Fanatics, Circa — what each promo is actually worth in cash terms.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/sportsbook-promos` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/sportsbook-promos`, siteName: "SportsBookISH", type: "website" },
};

// Internal estimates of cash conversion via low-hold matched betting. Rough
// industry averages — adjust per book as we learn each program's actual
// realised conversion. These are conservative.
const CONVERSION = {
  // bonus-bet promos convert at ~50-70% of face value via -110 on opposing low-hold lines
  draftkings: { multiplier: 0.65, type: "bonus bet" },
  fanduel: { multiplier: 0.65, type: "bonus bet" },
  betmgm: { multiplier: 0.65, type: "bonus bet" },
  caesars: { multiplier: 0.62, type: "bonus bet" },
  betrivers: { multiplier: 0.55, type: "2nd-chance bet" },
  fanatics: { multiplier: 0.70, type: "daily bonus bets" },
  circa: { multiplier: 0,    type: "no promo (sharp lines instead)" },
};

const HUB_FAQ = [
  {
    question: "What's the best sportsbook welcome offer right now?",
    answer: "FanDuel and DraftKings both run $200 bonus-bet offers on a $5 deposit — best risk-adjusted starting point. Caesars' $1,000 first-bet offer has higher upside if you're betting large but more variance. Fanatics' 10-day $100/day FanCash offer has the highest realised cash conversion (~70%) if you stay engaged.",
  },
  {
    question: "What does 'bonus bet' actually mean?",
    answer: "A bonus bet (sometimes 'free bet') returns your winnings minus the stake if it wins. A $100 bonus bet at +200 returns $200, not $300. To convert a bonus bet to cash, bet it at long odds on one side and the opposing side at a low-hold sportsbook with real money — locks in roughly 60-70% of the face value as guaranteed profit.",
  },
  {
    question: "Can I claim more than one offer?",
    answer: "Yes. The optimal new-bettor approach is to claim every regulated US sportsbook offer sequentially. Each is a one-time-per-person promo and the realised cash from converting all seven is typically $400-800 depending on conversion discipline.",
  },
  {
    question: "How do I convert a bonus bet to cash?",
    answer: "Bet the bonus bet at long American odds (typically +300 to +800) on Sportsbook A, then back the OPPOSITE side at -350 to -900 with real money at Sportsbook B where the combined hold is under 3%. Use our +EV scanner to find current low-hold opposing-side opportunities. Net result: guaranteed ~60-70% cash conversion regardless of which side wins.",
  },
];

export default function SportsbookPromosPage() {
  const renderTime = new Date().toISOString();
  // Sort books by conversion multiplier × promo value (proxy for "best deal")
  const ordered = ALL_BOOK_KEYS
    .filter((k) => k in CONVERSION)
    .map((k) => ({ ...SPORTSBOOKS[k], conversion: CONVERSION[k as keyof typeof CONVERSION] }))
    .sort((a, b) => b.conversion.multiplier - a.conversion.multiplier);

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sportsbooks", url: `${SITE_URL}/sportsbooks` },
        { name: "Promos", url: `${SITE_URL}/sportsbook-promos` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: "Regulated US sportsbook welcome offers — EV-converted",
        description: DESC,
        pageUrl: `${SITE_URL}/sportsbook-promos`,
        dateModified: renderTime,
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4 gap-2">
          <Link href="/sportsbooks" className="text-sm text-muted-foreground hover:text-foreground shrink-0">← Sportsbooks</Link>
          <div className="font-semibold text-sm truncate">Sportsbook Welcome Offers</div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Best Sportsbook Welcome Offers 2026</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Every regulated US sportsbook&apos;s current new-user offer ranked by realised cash value. The
            &quot;EV converted&quot; column shows what each promo is actually worth after low-hold matched-betting
            conversion — not the marketing headline number.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ordered.map((b) => {
            const aff = affiliateUrl(b.key, { campaign: "sportsbook-promos" });
            return (
              <Card key={b.key} className="hover:border-emerald-500/40 transition-colors">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{b.name}</span>
                    <Badge variant="outline" className="text-xs">{b.conversion.type}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-3">
                  <div className="font-semibold text-foreground">{b.promo_summary}</div>
                  <div className="text-xs text-muted-foreground">{b.primary_states}</div>
                  {b.conversion.multiplier > 0 && (
                    <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                      <strong className="text-emerald-400">EV converted:</strong>
                      {" "}~{Math.round(b.conversion.multiplier * 100)}% of face value via low-hold matched betting
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground/80 leading-relaxed">{b.edge}</div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {aff && (
                      <a href={aff} target="_blank" rel="sponsored noopener noreferrer"
                        className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-600 text-emerald-950 text-sm font-medium">
                        Claim {b.name} →
                      </a>
                    )}
                    <Link href={`/sportsbooks/${b.key}`} className="px-4 py-2 rounded-md border border-border/60 hover:bg-muted text-sm">
                      Full review →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3">How to convert any bonus bet to cash</h2>
          <Card>
            <CardContent className="p-4 text-sm space-y-2">
              <p><strong>Step 1.</strong> Claim the offer at the regulated US book of your choice. Deposit + place the qualifying bet (often as small as $5).</p>
              <p><strong>Step 2.</strong> Receive your bonus bet credit (typically face value $100-$1,000 depending on the book).</p>
              <p><strong>Step 3.</strong> Find a low-hold opposing-side bet using SportsBookISH&apos;s scanners — Kalshi event contracts are often the cleanest counter-side.</p>
              <p><strong>Step 4.</strong> Stake the bonus bet at long odds (e.g. +500) on Side A. Stake real money at the opposing side (e.g. -550) so both legs return approximately the same payout.</p>
              <p><strong>Step 5.</strong> One leg wins. The other doesn&apos;t. Net result: ~60-70% of the bonus bet face value, locked in as cash.</p>
              <p className="text-xs text-muted-foreground pt-2">Detailed walkthroughs and current low-hold pairs are surfaced live on our <Link href="/sports/arbitrage" className="text-emerald-400 hover:underline">arbitrage scanner</Link> and <Link href="/sports/positive-ev" className="text-emerald-400 hover:underline">+EV finder</Link>.</p>
            </CardContent>
          </Card>
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
