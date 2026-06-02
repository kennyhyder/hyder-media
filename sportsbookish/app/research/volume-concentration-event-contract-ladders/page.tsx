import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { LastUpdated } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Volume concentration in event-contract ladders";
const DESC = "Why the 80+ wins rung trades 200 contracts while the 75+ and 85+ rungs trade 9 and 14 — and why pricing the thin rungs off the same trade volume is statistical noise, not signal.";

export const metadata: Metadata = {
  title: `${TITLE} | SportsBookISH Research`,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/research/volume-concentration-event-contract-ladders` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/research/volume-concentration-event-contract-ladders`, siteName: "SportsBookISH", type: "article" },
};

export default function Article() {
  const renderTime = new Date().toISOString();
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Research", url: `${SITE_URL}/research` },
        { name: TITLE, url: `${SITE_URL}/research/volume-concentration-event-contract-ladders` },
      ])} />
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle",
        headline: TITLE,
        description: DESC,
        datePublished: "2026-06-01",
        dateModified: "2026-06-01",
        author: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
        publisher: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` } },
        mainEntityOfPage: `${SITE_URL}/research/volume-concentration-event-contract-ladders`,
      }} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/research" className="text-sm text-muted-foreground hover:text-foreground">← Research</Link>
          <div className="font-semibold text-sm hidden md:block">SportsBookISH Research</div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <article className="container mx-auto max-w-3xl px-4 py-10 prose prose-invert">
        <div className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">Market microstructure · Published June 1, 2026</div>
        <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-2">{TITLE}</h1>
        <p className="text-muted-foreground text-lg leading-relaxed mb-8">
          Most event-contract markets aren&apos;t one market — they&apos;re a ladder. &quot;Mariners win 80+ games this season&quot; is one
          rung. &quot;Mariners win 75+&quot; and &quot;Mariners win 85+&quot; are adjacent rungs. The pricing on the popular threshold is
          what gets discussed. The pricing on the unpopular thresholds is almost entirely noise.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">The example</h2>
        <p>
          From our quote data the morning of May 27, 2026: the Seattle Mariners &quot;wins this season&quot; ladder on Kalshi looked like this:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2 font-mono text-sm">
          <li>70+ wins: 96.0% · 18 contracts traded in 24h</li>
          <li>75+ wins: 90.0% · 9 contracts traded in 24h</li>
          <li><strong>80+ wins: 70.0% · 200 contracts traded in 24h</strong></li>
          <li>85+ wins: 28.0% · 14 contracts traded in 24h</li>
          <li>90+ wins: 8.0% · 6 contracts traded in 24h</li>
        </ul>
        <p>
          The 80+ rung carries roughly 80% of the ladder&apos;s total volume — 200 contracts versus 47 combined for the other four
          rungs. This isn&apos;t market efficiency choosing where to trade; it&apos;s reflection of where the public marketing was
          done. Kalshi advertised the 80+ market on social, news outlets cited 80+ wins as the &quot;will the Mariners be good&quot;
          threshold, and traders followed the headline.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Why this matters</h2>
        <p>
          Price discovery in any market requires actual trades. When a market has 200 contracts trading per day, every bid/ask quote
          competes against real money. The mid-price reflects what marginal buyers and sellers actually believe.
        </p>
        <p>
          When a market has 9 contracts trading per day, the mid-price reflects whatever stale limit orders one or two retail traders
          left in the book. A new buyer can move the implied probability 5-10 percentage points by hitting the ask once. The price is
          there but the <em>information content</em> isn&apos;t.
        </p>
        <p>
          Concretely: the 75+ wins rung shows 90% implied probability. That looks tight — 6 percentage points off the 80+ rung
          which is at 70%. But that 90% is based on 9 contracts. The real-information probability of 75+ wins, given the 80+
          rung&apos;s 70% pricing, is probably more like 85-92%. The exact answer depends on the joint distribution, and the
          75+ rung&apos;s posted 90% is consistent with that range — but it could just as easily be off by 3-5 percentage points.
          The number you see is more noise than signal.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">The HiveMind insight</h2>
        <p>
          We&apos;ve been reposting alerts on the loud rung (&quot;80+ wins at 70%, +6.5pp in 24h on $361k volume&quot;) and the
          HiveMind account has been calling these out — correctly. The biggest move in this ladder isn&apos;t the 80+ rung. It&apos;s
          the 2+ wins direction (when the favorite increases their lead, the 90+ rung repricing matters more than the 80+ which
          has effectively settled). The alert that surfaces the loud rung misses where the actual price discovery is happening.
        </p>
        <p>
          What HiveMind is identifying — and what our updated alert system now captures — is that the SHARPER signal is on the
          rungs where the price is genuinely uncertain (15% to 85% implied) and the volume is meaningful (≥250 contracts/24h).
          The boring rung at 90+% is settled. The exciting rung at 8% is noise. The middle rung carrying meaningful volume is
          where the actual market discovery is happening.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">How to read a ladder</h2>
        <p>
          When you encounter an event-contract ladder, do this:
        </p>
        <ol className="list-decimal list-inside space-y-1 pl-2">
          <li>Sort by implied probability descending</li>
          <li>Drop any rung in [0%, 18%] or [82%, 100%] — settled or settling, no signal</li>
          <li>Of the remaining rungs, identify the one with the most 24h volume</li>
          <li>That&apos;s the price-discovery rung. Treat the others as illustrative, not pricing.</li>
          <li>Look for monotonicity violations (T20 priced higher than T10) — these are market-maker mistakes, occasionally arbable</li>
        </ol>
        <p>
          Our updated alert system follows this exact algorithm. Movement alerts now report the rung with the largest absolute
          information move, not the rung with the largest percentage move. They&apos;re different things, and the difference is
          where the analytical edge lives.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Cross-platform implications</h2>
        <p>
          The volume-concentration pattern is even more pronounced on Polymarket than on Kalshi because Polymarket users skew
          toward fewer-but-larger positions. A typical Polymarket sports ladder might have one rung carrying 95% of the volume and
          four rungs carrying combined &lt;5%. Those four rungs are essentially decoration.
        </p>
        <p>
          For sportsbooks, the concentration is different in shape but similar in implication. DraftKings player props have ~20
          alternate lines per stat per game, but 80% of the action is on the headline line. The alternates exist for shopping
          opportunities (matched betting, low-hold arbs) but their prices are not informationally efficient and should be read as
          quote-shopping data, not as &quot;the market thinks X.&quot;
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Practical takeaway</h2>
        <p>
          Three rules when looking at any event-contract or alternate-line ladder:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>Volume below ~50 contracts per 24h = read the price as illustrative, not authoritative.</li>
          <li>Adjacent-rung prices that look weirdly tight (1-3pp apart) on thin rungs are usually just stale limit orders, not actual market consensus.</li>
          <li>The rung with the most volume IS the consensus price for the underlying thesis. The other rungs are derivatives.</li>
        </ul>
        <p>
          When you see SportsBookISH alerts highlighting a particular rung as the &quot;biggest move,&quot; we&apos;ve already
          filtered for the rung where the volume justifies treating the move as signal. You can trust the call. The alternative
          rungs in the same ladder may be moving in the same direction, but those moves are mechanical — not new information.
        </p>

        <div className="mt-12 pt-6 border-t border-border/40 text-sm text-muted-foreground">
          <p className="mb-3">
            <strong>Source data:</strong> 100M+ Kalshi + Polymarket quotes since May 2026.
            Volume concentration ratios computed per (player, stat_family) ladder grouping.
            Full dataset open at <Link href="/data" className="text-emerald-400 hover:underline">/data</Link>.
          </p>
          <p>
            <strong>Companion reading:</strong>{" "}
            <Link href="/research/why-mid-game-kalshi-lines-lag" className="text-emerald-400 hover:underline">Why mid-game Kalshi lines lag sportsbook consensus</Link>
            {" · "}
            <Link href="/research/how-sportsbooks-reprice-without-news" className="text-emerald-400 hover:underline">How sportsbooks reprice without news</Link>
          </p>
        </div>
      </article>
    </div>
  );
}
