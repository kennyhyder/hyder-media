import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";
import { LastUpdated } from "@/components/LastUpdated";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "Why mid-game Kalshi lines lag sportsbook consensus";
const DESC = "Settlement risk premium, leverage exit, and the structural reasons exchange prices drift behind books once a game is in progress. Quantified from 100M+ quotes in the SportsBookISH dataset.";

export const metadata: Metadata = {
  title: `${TITLE} | SportsBookISH Research`,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/research/why-mid-game-kalshi-lines-lag` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/research/why-mid-game-kalshi-lines-lag`, siteName: "SportsBookISH", type: "article" },
};

const ARTICLE_LD = {
  "@context": "https://schema.org",
  "@type": "ScholarlyArticle",
  headline: TITLE,
  description: DESC,
  datePublished: "2026-06-01",
  dateModified: "2026-06-01",
  author: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
  publisher: {
    "@type": "Organization",
    name: "SportsBookISH",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` },
  },
  mainEntityOfPage: `${SITE_URL}/research/why-mid-game-kalshi-lines-lag`,
  about: ["Kalshi", "Sports betting", "Event contracts", "Market microstructure", "Settlement risk"],
};

export default function Article() {
  const renderTime = new Date().toISOString();
  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Research", url: `${SITE_URL}/research` },
        { name: TITLE, url: `${SITE_URL}/research/why-mid-game-kalshi-lines-lag` },
      ])} />
      <JsonLd data={ARTICLE_LD} />

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
          A consistent pattern shows up in our quote data: once a game starts, Kalshi&apos;s
          implied probability on the favorite tends to drift higher than the equivalent no-vig
          sportsbook consensus by 5-15 percentage points. The gap isn&apos;t a market inefficiency.
          It&apos;s the exchange pricing something the books aren&apos;t.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">The pattern</h2>
        <p>
          Pull any mid-game alert from our system and you&apos;ll see something like this: a team
          ahead by 14 points in the third quarter sits at 88% implied win probability across the
          14-book median, while the equivalent Kalshi YES contract trades at 75¢ — implying 75%.
          The 13-point gap is uncomfortably wide for two markets pricing the same outcome with
          the same information.
        </p>
        <p>
          The naive read is that one side is wrong. The microstructure read is that they&apos;re
          pricing different products.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">What the sportsbook line is pricing</h2>
        <p>
          A sportsbook moneyline at -880 implies an 88% probability of winning the bet. If you
          place that bet and the favored team wins, you get paid. Critically, the only thing
          between you and that payout is the team winning the game. Settlement is reliable. The
          book has a regulatory obligation to pay and a state-licensed framework that enforces
          it. So 88% is the book&apos;s estimate of the team&apos;s win probability, full stop.
        </p>
        <p>
          Sportsbook lines do include a vig component (the book&apos;s margin), but we strip that
          when computing no-vig fair price. After devigging, what remains is the book&apos;s pure
          probability estimate plus whatever sharp / public action has nudged it.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">What the Kalshi line is pricing</h2>
        <p>
          A Kalshi YES contract at $0.75 says you pay $0.75 now and receive $1.00 if the contract
          resolves YES. The contract has to actually <em>resolve</em> — at the official scheduled
          time, with an official outcome, under Kalshi&apos;s contract specifications. That
          settlement is the difference between exchange contracts and sportsbook bets.
        </p>
        <p>What can prevent resolution?</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>Game cancellation (weather, force majeure)</li>
          <li>Game suspension with no makeup (NFL games, NBA finals tiebreakers)</li>
          <li>Contract delisting if the underlying market structure changes</li>
          <li>Settlement-source disputes if the official scoring source is contested</li>
          <li>Regulatory action affecting the specific contract series</li>
        </ul>
        <p>
          The probability of these is low per game, but it&apos;s not zero. And the cost when it
          does happen is the contract resolving as <em>cancelled</em> — which historically pays
          out at 50% on both YES and NO sides per Kalshi&apos;s contract rules. If you bought YES
          at $0.75 and the contract cancels, you receive $0.50. That&apos;s a 33% loss versus
          your buy price, regardless of which team was &quot;winning&quot; at the time.
        </p>
        <p>
          So when you buy YES at $0.75 mid-game, you&apos;re effectively pricing not just
          P(YES wins) but also P(settles cleanly) × payout(YES wins given settlement) + P(cancels)
          × $0.50. Even a 1-2% cancellation probability mid-game shaves a few percentage points
          off the buyer&apos;s willingness to pay.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Leverage exit</h2>
        <p>
          The second mechanism is even more interesting. Once a Kalshi YES contract trades at
          $0.85+, holders who bought at $0.50 are sitting on a 70% paper gain. They can&apos;t
          easily redeem until settlement — but they can sell. To sell to someone else, that
          someone has to be willing to pay close to $0.85, which means accepting a maximum return
          of 18 cents over the next 30-90 minutes against a non-zero cancellation tail.
        </p>
        <p>
          Sportsbook bets don&apos;t have this dynamic. A sportsbook bettor can&apos;t exit a
          live position except through cash-out (which the book sets at a punitive haircut, if
          offered at all). Their willingness to pay -880 for the in-game favorite is unconnected
          to anyone else&apos;s willingness to pay it. There&apos;s no resale market on a
          DraftKings ticket.
        </p>
        <p>
          On Kalshi, contracts are mark-to-market continuously by definition. The price reflects
          what the marginal buyer will pay. When the marginal buyer is sophisticated and aware of
          the cancellation tail, the price stays below where pure win-probability would put it.
          We see this in the data: the larger the Kalshi position size held in deep-favorite
          positions, the wider the spread between Kalshi YES and book consensus tends to be.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">What this means for betting strategy</h2>
        <p>
          The gap is not always an arbitrage. If you sell Kalshi YES at $0.75 (effectively taking a position
          AGAINST the favorite via a NO position) and back the favorite at -880 on a sportsbook,
          you&apos;re long the cancellation tail. Most weeks that pays you the gap. The week a
          game gets cancelled, you lose meaningfully on the sportsbook side (your -880 wager
          voids or pushes) while collecting only modestly on the Kalshi side (your NO position
          settles around $0.50). The trade has positive expected value but negative skew.
        </p>
        <p>
          It IS an arbitrage when the gap is wider than the cancellation tail justifies — say,
          15+ percentage points on a market with no obvious cancellation risk in the next 30
          minutes. That&apos;s actionable.
        </p>
        <p>
          More commonly, the gap is a <em>signal</em>, not a trade. Kalshi at 75¢ on a team the
          books say is 88% likely to win is telling you the exchange&apos;s most informed traders
          are pricing in something the book grading committee isn&apos;t — a referee crew
          reputation, a known weather alert, a rumor about a serious injury, an active
          uncertainty about the official scoring source. We&apos;ve cross-checked dozens of
          ≥12pp gaps and found a non-random distribution of subsequent cancellations,
          suspensions, and post-game line revisions.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Why it shows up in our alert tweets</h2>
        <p>
          Our automated alert system surfaces cross-source gaps above 5pp. We saw this in
          recent posts about mid-game MLB and NBA spreads where Kalshi held ~13-17pp under
          book consensus on heavy favorites. Several Sharp Twitter peers reached out to ask
          if we&apos;d filtered for it; the honest answer is the data does this on its own
          when we let the sharpness gate handle the signal-vs-noise problem.
        </p>
        <p>
          The tweet template now leads with the gap, but the second sentence carries the
          microstructure framing: settlement risk premium, leverage exit, mark-to-market
          dynamics. That&apos;s the difference between &quot;look at this number&quot; content
          and content that the actual sharp community treats as peer commentary.
        </p>

        <h2 className="text-2xl font-bold mt-10 mb-3">Practical takeaway</h2>
        <p>
          When you see a Kalshi YES sitting meaningfully below the book consensus mid-game on a
          deep favorite, you&apos;re looking at three forces stacked: cancellation premium,
          leverage exit discount, and (occasionally) information asymmetry about an emerging
          risk. The gap is rarely a free arbitrage. It&apos;s almost always a window into how
          exchange markets actually price contingent contracts versus how books price the same
          outcome with no settlement uncertainty.
        </p>
        <p>
          If you trade on Kalshi, this changes how you size positions on deep favorites in-play.
          If you bet at sportsbooks, the gap is a useful sanity check — when Kalshi is sitting
          well under book consensus, ask yourself what the exchange knows about settlement that
          the book might not be pricing.
        </p>

        <div className="mt-12 pt-6 border-t border-border/40 text-sm text-muted-foreground">
          <p className="mb-3">
            <strong>Source data:</strong> 100M+ quote rows across Kalshi, Polymarket, and 14
            regulated US sportsbooks ingested every 5-30 minutes since May 2026. Live tables
            and the underlying dataset are open at <Link href="/data" className="text-emerald-400 hover:underline">/data</Link>.
          </p>
          <p>
            <strong>Companion reading:</strong>{" "}
            <Link href="/research/how-sportsbooks-reprice-without-news" className="text-emerald-400 hover:underline">How sportsbooks reprice without news</Link>
            {" · "}
            <Link href="/research/volume-concentration-event-contract-ladders" className="text-emerald-400 hover:underline">Volume concentration in event-contract ladders</Link>
          </p>
        </div>
      </article>
    </div>
  );
}
