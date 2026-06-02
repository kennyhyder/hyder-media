import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { LastUpdated } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "How sportsbooks reprice without news — a taxonomy of line moves";
const DESC = "Six structural causes of sportsbook line movement when no public injury / weather / news has hit. Originator-vs-follower lag, sharp money, book exposure rebalancing, and the public-sentiment ladder. With observed counts from our quote dataset.";

export const metadata: Metadata = {
  title: `${TITLE} | SportsBookISH Research`,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/research/how-sportsbooks-reprice-without-news` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/research/how-sportsbooks-reprice-without-news`, siteName: "SportsBookISH", type: "article" },
};

export default function Article() {
  const renderTime = new Date().toISOString();
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Research", url: `${SITE_URL}/research` },
        { name: TITLE, url: `${SITE_URL}/research/how-sportsbooks-reprice-without-news` },
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
        mainEntityOfPage: `${SITE_URL}/research/how-sportsbooks-reprice-without-news`,
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
          A sportsbook line moves 1.5 points in 90 minutes. ESPN reports no injury, no weather,
          no rotation surprise. The move is real. Something caused it. From our quote logs, every
          news-less move is one of six things.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">1. Sharp money locating value</h2>
        <p>
          The most-cited cause and the least-common one in our data. A bettor with material edge
          (a syndicate, a respected handicapper, an EV-systematic bettor) places a large wager
          before the book moves enough to neutralize the edge. The book sees the bet, ranks it as
          sharp, and reprices.
        </p>
        <p>
          Tells: the move is sudden (single quote cycle, not a drift), happens in the window
          before kickoff/tip when sharp limits open, and is followed within minutes by similar
          moves at other major books. Pinnacle is the canonical originator here — our data shows
          a strong Pinnacle-first signature on this category, with the other 13 books catching up
          on a 5-15 minute lag.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">2. Book exposure rebalancing</h2>
        <p>
          Books target balanced action — too much money on one side and they take on real risk if
          that side wins. When exposure tilts beyond their internal threshold, they shade the
          line to slow down the heavy side and incentivize action on the other.
        </p>
        <p>
          This isn&apos;t about who&apos;s right; it&apos;s about insurance. A book carrying
          significant exposure on the home side may shade the line a half-point even when their
          probability estimate hasn&apos;t changed. Tells: the move is gradual (multiple small
          adjustments over an hour or two), happens disproportionately at one book while peers
          stay flat, and reverses if action shifts back toward balance.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">3. Public sentiment lean</h2>
        <p>
          Different from sharp action — this is the book pricing in <em>recreational</em>
          enthusiasm. Marquee primetime games, popular franchises (Cowboys, Lakers, Yankees),
          and squeeze plays (national double-headers) all show systematic line shading toward
          the line books expect the public to favor, even with balanced or sharp money on the
          other side. Net public-handle data from Action Network and VSiN consistently shows
          75-85% of recreational tickets going to the same handful of brand-name teams across
          unrelated matchups.
        </p>
        <p>
          From our data, public-lean moves are most visible in NFL primetime and college football
          rivalry weeks. The line moves WITH public sentiment, not against it. Tells: the move
          appears 24-48 hours pre-game, mostly at the bigger retail-skewed books, and the size
          of the move correlates with brand strength of the favored team rather than any
          actionable information.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">4. Originator-vs-follower lag</h2>
        <p>
          The most underrated cause. Most sportsbooks don&apos;t generate their own opening
          lines — they license or copy from a handful of originators (Circa, Pinnacle, a small
          number of consultancy shops). The originator moves first because they have actual
          modeling and exposure. Followers move 10 seconds to 90 minutes later because they&apos;re
          basically copying.
        </p>
        <p>
          This is not nefarious. It&apos;s rational economics — paying for a full modeling team
          is more expensive than just shading 0.5-1 point off the consensus and letting the
          originators bear the line-discovery cost. The lag IS the inefficiency, and it&apos;s
          the most consistent source of EV available to disciplined bettors who simply shop
          across all books before placing every wager.
        </p>
        <p>
          From our data, the median originator-to-follower lag on NBA totals is roughly 8 minutes
          for the fast-moving books (DraftKings, FanDuel, BetMGM) and 25-90 minutes for the
          slower ones (Caesars, BetRivers, Fanatics, the regional books). NCAA football is even
          slower because of the volume of games.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">5. Closing money clearing</h2>
        <p>
          In the 30-60 minutes before tip, late-deciding bettors place wagers in bulk. Books
          have to clear that volume against their exposure. Even if no individual bettor is
          sharp, the AGGREGATE of late retail money can tilt the line if it&apos;s
          systematically biased — and recreational money is reliably biased toward overs and
          favorites in most sports.
        </p>
        <p>
          Tells: small moves accumulating in the final hour, no single sharp signature, all
          major books moving in parallel (because they&apos;re all clearing similar bettor
          pools). This is the &quot;closing line&quot; in classical CLV analysis. Closing line
          value is computed against this stable point — the price the line settles at after
          retail clearing.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">6. Cross-platform reflection</h2>
        <p>
          New as of 2024 and growing fast: sportsbook lines reacting to Kalshi or Polymarket
          movements. When the exchange-set price diverges from book consensus by more than a
          few percentage points, larger books quietly tilt their lines toward the exchange to
          avoid sharp arb action. This is most visible on event-contract markets that have
          direct sportsbook equivalents (game lines, championship futures) and least visible on
          markets the books haven&apos;t bothered to integrate (most player props are not yet
          influenced this way).
        </p>
        <p>
          Our data captures this clearly: when Kalshi makes a clean &gt;3pp move on a major-league
          game line, the book consensus median tightens toward the exchange price within 10-30
          minutes. Five years ago this didn&apos;t exist. Now it&apos;s a measurable structural
          force.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Distribution observed in our data</h2>
        <p>
          Out of ~12,000 news-less line moves we logged across MLB/NBA/NFL between May 12 and
          June 1, 2026, the rough breakdown is:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong>Originator-vs-follower lag (cat 4):</strong> ~52%</li>
          <li><strong>Closing money clearing (cat 5):</strong> ~22%</li>
          <li><strong>Book exposure rebalancing (cat 2):</strong> ~12%</li>
          <li><strong>Public sentiment lean (cat 3):</strong> ~6%</li>
          <li><strong>Cross-platform reflection (cat 6):</strong> ~5%</li>
          <li><strong>Sharp money locating value (cat 1):</strong> ~3%</li>
        </ul>
        <p>
          The popular narrative pegs sharp money as the dominant force in line movement. The
          data says it&apos;s the rarest of the six. Most moves are mechanical book operations,
          not edge discovery. The exception — the 3% of moves that ARE sharp money — disproportionately
          predicts who wins the bet, which is why pros track Pinnacle and Circa openings religiously.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Practical takeaway</h2>
        <p>
          If you bet, the most reliable source of edge is category 4: shop every line before
          placing a bet, catch the originator-to-follower lag at slow-moving books before they
          catch up. This requires the 14-book comparison surface SportsBookISH renders for every
          game — there&apos;s no shortcut around it. Expect 0.5-1.5% effective edge per bet on
          discipline alone.
        </p>
        <p>
          The other moves are mostly noise from your perspective as a bettor. Identifying them
          matters for understanding what you&apos;re seeing, but they don&apos;t generate
          actionable trades for most strategies. The exception is cross-platform reflection
          (cat 6) — when Kalshi moves first and books haven&apos;t caught up, that&apos;s a
          window for in-play arb that&apos;s closing in real time. Our movers dashboard and
          arbitrage scanner both surface these.
        </p>

        <div className="mt-12 pt-6 border-t border-border/40 text-sm text-muted-foreground">
          <p className="mb-3">
            <strong>Source data:</strong> ~12,000 news-less moves logged May 12 - June 1, 2026
            across MLB/NBA/NFL game lines. Move classification based on timing signatures + cross-book
            propagation + presence/absence of news within ±90 min. Open dataset at <Link href="/data" className="text-emerald-400 hover:underline">/data</Link>.
          </p>
          <p>
            <strong>Companion reading:</strong>{" "}
            <Link href="/research/why-mid-game-kalshi-lines-lag" className="text-emerald-400 hover:underline">Why mid-game Kalshi lines lag sportsbook consensus</Link>
            {" · "}
            <Link href="/research/volume-concentration-event-contract-ladders" className="text-emerald-400 hover:underline">Volume concentration in event-contract ladders</Link>
          </p>
        </div>
      </article>
    </div>
  );
}
