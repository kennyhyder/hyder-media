import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export const metadata: Metadata = {
  title: "Methodology — how SportsBookISH computes Kalshi vs book edges",
  description: "Detailed methodology: how we de-vig sportsbook prices, compute Kalshi implied probabilities, calculate edges net-of-fee, filter stale references, and source data from Kalshi, The Odds API, DataGolf, and Polymarket.",
  alternates: { canonical: `${SITE_URL}/about/methodology` },
};

export default function MethodologyPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "About", url: "/about/kenny-hyder" },
          { name: "Methodology", url: "/about/methodology" },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "SportsBookISH Methodology",
          description: "How SportsBookISH computes edges between Kalshi and sportsbooks.",
          author: { "@type": "Person", name: "Kenny Hyder", url: `${SITE_URL}/about/kenny-hyder` },
          datePublished: "2026-05-15",
          dateModified: "2026-05-15",
          mainEntityOfPage: `${SITE_URL}/about/methodology`,
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">Methodology</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Methodology</h1>
        <p className="text-sm text-muted-foreground mb-8">
          By <Link href="/about/kenny-hyder" className="text-emerald-500 hover:underline">Kenny Hyder</Link> · Last reviewed 2026-05-15
        </p>

        <div className="prose prose-invert max-w-none">
          <p>
            This page documents exactly how SportsBookISH computes every edge, probability, and recommendation surfaced across the site. Goal: full transparency, no hidden assumptions, citable formulas.
          </p>

          <h2 className="text-2xl font-bold mt-6">Data sources</h2>
          <ul>
            <li><strong>Kalshi REST API</strong> (free, public) — primary price source. Ingested every 5 minutes via cron.</li>
            <li><strong>The Odds API</strong> (Starter tier, $30/mo) — sportsbook lines for NBA, NFL, MLB, NHL, EPL, MLS, UCL, World Cup. Pulled every 15-30 minutes. h2h, spreads, totals markets.</li>
            <li><strong>DataGolf Scratch+</strong> ($30/mo) — golf modeling baselines (win/top-N probabilities) + 11+ book aggregation. Pulled every 10 minutes during active tournaments.</li>
            <li><strong>Polymarket Gamma API</strong> (free, public) — peer-to-peer prediction-market comparison for select sports markets. Pulled every 15 minutes.</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Kalshi implied probability</h2>
          <p>For each Kalshi market we receive yes_bid, yes_ask, and last_price. The implied probability is computed:</p>
          <ol>
            <li>If both yes_bid {">"} 0 and yes_ask {">"} yes_bid AND (yes_ask - yes_bid) ≤ 0.10 AND yes_ask {"<"} 1.00:{" "}
              implied = (yes_bid + yes_ask) / 2 — bid/ask midpoint.</li>
            <li>Else if last_price is between 0 and 1: implied = last_price.</li>
            <li>Else if bid and ask both exist but the spread is wide: implied = (yes_bid + yes_ask) / 2.</li>
            <li>Otherwise: null (no actionable price).</li>
          </ol>
          <p>This logic prevents dust quotes (e.g., yes_bid=0, yes_ask=1¢ on a quiet market) from being read as a 0.5% midpoint when the actual market traded at 50%.</p>

          <h2 className="text-2xl font-bold mt-6">Sportsbook de-vig</h2>
          <p>
            We use <strong>multiplicative normalization</strong> per-market: for each book&apos;s set of outcomes within a single market, sum the raw implied probabilities and divide each side by the total. The result sums to exactly 100% (or to the appropriate target for multi-winner markets like top-5 or top-10).
          </p>
          <p>
            <Link href="/learn/glossary/no-vig" className="text-emerald-500 hover:underline">No-vig explained →</Link>
          </p>

          <h2 className="text-2xl font-bold mt-6">Books median</h2>
          <p>
            For each side of each market, we take the median of de-vigged probabilities across all books we have a quote from in the last 30 minutes. Median (not mean) because individual books occasionally post stale or outlier lines; median is robust to one or two outliers.
          </p>

          <h2 className="text-2xl font-bold mt-6">Edge calculation</h2>
          <p>
            <strong>Buy edge = Reference probability − Kalshi implied probability.</strong>
          </p>
          <ul>
            <li><strong>Positive edge</strong> = Kalshi is priced cheaper than the reference. Buy YES on Kalshi.</li>
            <li><strong>Negative edge</strong> = Kalshi is priced more expensively than the reference. Either sell YES on Kalshi or bet that side at the books.</li>
          </ul>
          <p>The reference is, in order of preference:</p>
          <ol>
            <li>The Pro+ user&apos;s home book (de-vigged), if they&apos;ve set one</li>
            <li>Books median with their excluded books removed (Pro+ user preference)</li>
            <li>Books median across all tracked books (default for free + signed-out users)</li>
          </ol>

          <h2 className="text-2xl font-bold mt-6">Net-of-fee edge (Pro+)</h2>
          <p>
            Pro and Elite subscribers see edges <em>after</em> Kalshi&apos;s per-contract trading fee. Formula:
          </p>
          <pre className="bg-card border border-border/60 rounded p-4 text-sm">
{`fee_per_contract_cents = max(1, ceil(0.07 × p × (1-p) × 100))
fee_per_contract_cents = min(fee_per_contract_cents, 7)
net_buy_edge = gross_buy_edge - (fee_per_contract_cents / 100)`}
          </pre>
          <p>The fee is symmetric for buys and sells. The formula peaks at 2¢ per contract near 50% probability, dropping to 1¢ at the extremes and capped at 7¢.</p>

          <h2 className="text-2xl font-bold mt-6">Stale reference filtering</h2>
          <p>
            Any quote (Kalshi, books, DataGolf model, Polymarket) older than 30 minutes is filtered out before edge calculation. This prevents stale book lines from creating phantom edges during live events when prices move every few minutes.
          </p>

          <h2 className="text-2xl font-bold mt-6">DataGolf model (golf only)</h2>
          <p>
            DataGolf publishes a baseline win/top-N probability for each player at each tournament, computed from their proprietary strokes-gained model with adjustments for course fit, recent form, and field strength. We treat this as a third reference point alongside the books median.
          </p>
          <p>DataGolf closes some markets mid-tournament (e.g., make_cut after R2). We handle this gracefully by returning empty data for those markets rather than crashing.</p>

          <h2 className="text-2xl font-bold mt-6">Movement detection</h2>
          <p>
            Every 5 minutes, the movement detector compares Kalshi&apos;s current implied probability for each market against the rolling baseline (15 minutes prior). When the absolute change exceeds 2% (configurable), we record a movement event used for:
          </p>
          <ul>
            <li>League-page &ldquo;Recent moves&rdquo; widget</li>
            <li>Per-event &ldquo;Recent moves on this event&rdquo; section</li>
            <li>Email + SMS alert dispatch for Elite subscribers with custom rules</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Closed-event archive</h2>
          <p>
            When an event passes its grace period (12 hours for games, 1-3 weeks for futures, depending on type), the cron snapshots its final Kalshi + books state and transitions it to status=closed. Archive snapshots preserve the closing prices forever so historical edge analysis remains possible.
          </p>

          <h2 className="text-2xl font-bold mt-6">Limitations + caveats</h2>
          <ul>
            <li>We don&apos;t track every sportsbook — coverage focuses on US legal books plus Pinnacle (offshore reference). Niche books may have better prices we&apos;re not surfacing.</li>
            <li>The Odds API has its own data quality — occasional stale lines or missing outcomes. We try to detect + filter these.</li>
            <li>For low-volume Kalshi markets, bid/ask spreads can be wide enough that the &ldquo;implied probability&rdquo; is more theoretical than executable. The bet tracker logs the price you actually got, not the displayed midpoint.</li>
            <li>Past performance ≠ future results. Edge math is a probability framework, not a prediction. Bet responsibly.</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Open methodology</h2>
          <p>
            The full ingest + edge code is hosted in a public repository (the application is closed-source but core math is published).{" "}
            <Link href="/learn/glossary" className="text-emerald-500 hover:underline">Browse the glossary</Link> for plain-English definitions of every term used above.
          </p>

          <p className="text-xs text-muted-foreground border-t border-border/40 pt-4 mt-8">
            Questions or corrections? Use the <Link href="/contact" className="text-emerald-500 hover:underline">contact form</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
