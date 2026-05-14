import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import MarketingNav from "@/components/nav/MarketingNav";
import { ArrowRight } from "lucide-react";
import { JsonLd, breadcrumbLd, faqLd, SITE_URL } from "@/lib/seo";

interface Article {
  slug: string;
  title: string;
  metaDescription: string;
  excerpt: string;
  content: { type: "h2" | "p" | "ul" | "h3"; text?: string; items?: string[] }[];
  faq: { question: string; answer: string }[];
  relatedLinks: { title: string; url: string }[];
}

const ARTICLES: Record<string, Article> = {
  "what-are-kalshi-odds": {
    slug: "what-are-kalshi-odds",
    title: "What are Kalshi odds?",
    metaDescription:
      "Kalshi event contracts trade like stocks — the YES price (1¢–99¢) is the implied probability the outcome happens. Here's how to read them, why they differ from sportsbook lines, and what 'no-vig' means.",
    excerpt:
      "Kalshi is a CFTC-regulated event-contract exchange. Every market is a YES/NO question priced between 1¢ and 99¢ — and that price IS the implied probability. Here's the full breakdown.",
    content: [
      { type: "h2", text: "Kalshi in one paragraph" },
      {
        type: "p",
        text: "Kalshi is a regulated event-contract exchange licensed by the US Commodity Futures Trading Commission (CFTC). It lets users buy and sell shares in real-world outcomes — politics, weather, sports, economics — with each share paying $1 if the answer is YES and $0 if NO. Because shares trade peer-to-peer rather than against a house, the market price reflects the collective implied probability of the event happening, with no vigorish (built-in profit margin) baked in.",
      },
      { type: "h2", text: "How to read a Kalshi price" },
      {
        type: "p",
        text: "If 'Will the Lakers beat the Spurs?' is trading at 67¢ YES on Kalshi, that means the market is pricing the Lakers' win probability at 67%. A NO share trades at 33¢ (100¢ - 67¢). Buying YES at 67¢ pays out $1.00 if the Lakers win, for a profit of 33¢ — or +49% on your stake. The American-odds equivalent of 67% implied probability is roughly -204.",
      },
      { type: "h2", text: "How Kalshi differs from sportsbook odds" },
      {
        type: "p",
        text: "A sportsbook like DraftKings or FanDuel sets its own prices and charges a margin (the 'vig') so that the implied probabilities of both sides sum to more than 100% — typically 104–106% across moneyline markets. That extra 4–6% is the book's profit. Kalshi, being peer-to-peer, has no vig: YES + NO always sums to exactly 100% (minus a small spread between bid and ask).",
      },
      { type: "h2", text: "When Kalshi disagrees with the books" },
      {
        type: "p",
        text: "Because the two markets have different participants and pricing mechanisms, they regularly diverge. SportsBookISH highlights these gaps in real time across every game. A buy edge means Kalshi is pricing the outcome cheaper than the de-vigged consensus across DraftKings, FanDuel, BetMGM and the rest — a potentially profitable buying opportunity. A sell edge means Kalshi is overpriced.",
      },
      { type: "h2", text: "What sports does Kalshi cover?" },
      { type: "p", text: "Kalshi's sports coverage includes:" },
      {
        type: "ul",
        items: [
          "NBA — championship winner, game winners, MVP, conference champions, series outcomes",
          "MLB — championship winner, game winners, division leaders",
          "NHL — championship winner, game winners, series outcomes",
          "EPL — match winners, season champion",
          "MLS — match winners",
          "PGA Tour — tournament winner, Top 5/10/20/40, Make Cut, head-to-head matchups, round leaders, props",
        ],
      },
      { type: "h2", text: "Should I bet on Kalshi instead of a sportsbook?" },
      {
        type: "p",
        text: "Kalshi's advantages are: no vig (cheaper pricing on the same outcome), no limits (you can bet as much as the orderbook supports without being capped), federal regulation (CFTC oversight), and operation in all 50 states. Sportsbooks have wider market coverage (props, parlays, live in-game), faster cashouts, and stronger promo offers. Sharp bettors often hold both and shop the price.",
      },
      { type: "h2", text: "How SportsBookISH helps" },
      {
        type: "p",
        text: "We ingest every active Kalshi sports market every 5 minutes and compare each price to the de-vigged consensus across 11+ US sportsbooks. The edge column shows you exactly where Kalshi is cheaper or more expensive than the books — letting you pick the better side of every market in seconds.",
      },
    ],
    faq: [
      {
        question: "Is Kalshi legal in the US?",
        answer:
          "Yes. Kalshi is licensed by the CFTC as a designated contract market (DCM) and operates legally in all 50 US states, including states where sports betting is restricted.",
      },
      {
        question: "Are Kalshi odds always better than sportsbooks?",
        answer:
          "No. Because Kalshi prices float on user supply and demand, they sometimes overprice an outcome relative to the books. SportsBookISH flags both directions — buy edges (Kalshi cheaper) and sell edges (Kalshi more expensive).",
      },
      {
        question: "How do I convert a Kalshi price to American odds?",
        answer:
          "For a YES price under 50¢: American = 100 / (price/100) - 100, then add the sign. For a YES price over 50¢: American = -1 × price / (1 - price) × 100. Example: 67¢ → roughly -203. Most converters online will do this automatically.",
      },
      {
        question: "What's the minimum bet on Kalshi?",
        answer:
          "Kalshi has no minimum dollar bet — you can buy as few as 1 contract (worth between 1¢ and 99¢). This is much lower than sportsbook minimums (often $1–$5).",
      },
    ],
    relatedLinks: [
      { title: "What is 'no-vig' and how is it calculated?", url: "/learn/no-vig-explained" },
      { title: "How to spot edges between Kalshi and sportsbooks", url: "/learn/kalshi-edge-betting" },
      { title: "Kalshi vs DraftKings", url: "/compare/kalshi-vs-draftkings" },
      { title: "Browse live odds", url: "/sports" },
    ],
  },
  "no-vig-explained": {
    slug: "no-vig-explained",
    title: "What is 'no-vig' and how is it calculated?",
    metaDescription:
      "Sportsbooks bake in a margin called the vig. Here's how to strip it out and convert any sportsbook price to a fair-probability comparison number you can use against Kalshi.",
    excerpt: "Vig (or 'juice') is the sportsbook's built-in margin. De-vigging lets you compare any book's price to Kalshi's vig-free pricing on equal terms.",
    content: [
      { type: "h2", text: "What is vig?" },
      {
        type: "p",
        text: "Vigorish — vig, juice, or the overround — is the sportsbook's margin. On a 50/50 game both sides will price at roughly -110, meaning the implied probability of each side is about 52.4%. Together that's 104.8% — the extra 4.8% is the book's edge regardless of outcome.",
      },
      { type: "h2", text: "Step-by-step de-vigging" },
      { type: "p", text: "Given a two-way market (both sides quoted):" },
      {
        type: "ul",
        items: [
          "Convert each side's American odds to raw implied probability. American +160 → 100/(160+100) = 38.5%. American -180 → 180/(180+100) = 64.3%.",
          "Sum them: 38.5% + 64.3% = 102.8%. The 2.8% over 100% is the vig.",
          "Divide each side by the sum to normalize: 38.5/102.8 = 37.4% and 64.3/102.8 = 62.6%. Those are the no-vig probabilities — they sum to 100% and represent the book's true assessment of each side.",
        ],
      },
      { type: "h2", text: "Why de-vig before comparing to Kalshi?" },
      {
        type: "p",
        text: "Kalshi has no vig — YES + NO always sums to exactly 100%. Comparing a Kalshi YES at 65¢ to a sportsbook's -200 (which implies 67% raw) is misleading. After de-vigging, the sportsbook's true assessment might be 64% — meaning Kalshi at 65¢ is actually slightly more expensive than the book's fair line, not cheaper.",
      },
      { type: "h2", text: "SportsBookISH does this for you" },
      {
        type: "p",
        text: "Every book quote we ingest gets de-vigged in real time. The 'Books median' column on every event page is the median across all books' de-vigged probabilities — your fair-line reference for comparing to Kalshi. The 'Best book' column is the de-vigged probability at the cheapest book (longest American odds).",
      },
      { type: "h2", text: "Multi-way markets" },
      {
        type: "p",
        text: "Three-way markets like soccer 1X2 (home / draw / away) work the same way: convert each outcome's American odds to raw probability, sum them, divide each by the sum. The total before normalization tells you the vig: typically 3–5% across the three sides.",
      },
    ],
    faq: [
      {
        question: "Why is BetMGM's vig sometimes negative?",
        answer:
          "Promo-boosted markets can have an implied sum below 100% — true positive expected value if you can find both sides. SportsBookISH flags these arbitrage opportunities automatically.",
      },
      {
        question: "Is de-vigging the same as 'fair line'?",
        answer:
          "Roughly yes. De-vigging assumes the sportsbook splits the vig evenly between sides, which is a reasonable but imperfect assumption. Sharp books like Pinnacle do; recreational books may shade one side more.",
      },
    ],
    relatedLinks: [
      { title: "What are Kalshi odds?", url: "/learn/what-are-kalshi-odds" },
      { title: "How to spot edges between Kalshi and sportsbooks", url: "/learn/kalshi-edge-betting" },
      { title: "Browse live odds", url: "/sports" },
    ],
  },
  "kalshi-edge-betting": {
    slug: "kalshi-edge-betting",
    title: "How to spot edges between Kalshi and sportsbooks",
    metaDescription:
      "A practical guide to finding consistent buy edges and sell edges on Kalshi vs the de-vigged sportsbook consensus. Cover thresholds, common traps, and the math.",
    excerpt: "Where to look, what threshold matters, and how to avoid the common traps (illiquid markets, stale book prices, scheduled-line moves).",
    content: [
      { type: "h2", text: "Buy edge vs sell edge" },
      {
        type: "p",
        text: "A buy edge means Kalshi is pricing an outcome cheaper than the de-vigged book consensus — you're getting a bargain. A sell edge means Kalshi is overpriced, meaning you can either sell YES on Kalshi (lock in profit if the market reverts) or simply bet the same side at the books instead.",
      },
      { type: "h2", text: "What threshold is actionable?" },
      {
        type: "ul",
        items: [
          "Under 1.5% — typically noise. Bid/ask spread + de-vig assumptions absorb most of this.",
          "1.5–3% — small edge. Worth tracking but usually not enough to overcome variance.",
          "3–5% — actionable. SportsBookISH's default Pro alert threshold sits here.",
          "5–10% — rare, worth investigating. Often a sign of a stale book line or fresh news.",
          "10%+ — almost always a data anomaly. Double-check the market URL on Kalshi before betting.",
        ],
      },
      { type: "h2", text: "Best book vs books median" },
      {
        type: "p",
        text: "Books median is the conservative target — the middle of the de-vigged distribution across all books. Best book is the most aggressive target — the cheapest book on that specific side. If you have accounts at multiple sportsbooks, comparing Kalshi to the best book reveals the maximum arbitrage potential.",
      },
      { type: "h2", text: "Common edge traps" },
      {
        type: "ul",
        items: [
          "Stale book lines — a sportsbook hasn't updated after a major injury. Cross-check breaking news before betting an outsized edge.",
          "Illiquid Kalshi markets — wide bid/ask spread (>5¢) means the mid-price is unreliable. Stick to markets with tight spreads.",
          "Scheduled line moves — books may move in unison ahead of a known catalyst (lineup announcement, weather report). Edges close fast in these windows.",
          "Stale Kalshi quotes — our data plane refreshes every 5 minutes. For sub-minute precision, click into the event page where you'll see exact Kalshi bid/ask + last trade.",
          "Asymmetric vig — books shade one side more than the other on heavy public bets. The de-vig assumption (split evenly) breaks down; use 'best book' instead.",
        ],
      },
      { type: "h2", text: "Building a system" },
      {
        type: "p",
        text: "Sustainable edge betting requires: (1) consistent threshold — pick 3% and stick to it; (2) bankroll management — never more than 2% of bankroll on any one edge; (3) record-keeping — track every bet and compare predicted vs actual edge accuracy. SportsBookISH's daily digest gives you the day's top 3 buy + sell candidates; set alerts on Pro/Elite for real-time delivery.",
      },
    ],
    faq: [
      {
        question: "What's the win rate at 3% edge?",
        answer:
          "Theoretically, if your edge math is accurate and you bet flat units, you should win 51.5% of plus-money bets at a 3% edge — yielding ~3% ROI before variance. Variance is high in small samples; expect drawdowns of 10+ units even with positive expected value.",
      },
      {
        question: "Can I bet both Kalshi and the books for arbitrage?",
        answer:
          "Yes, when the sum of YES on Kalshi plus the book's de-vigged NO is below 100%, you can lock a guaranteed profit. Look for negative implied-sum spreads in the 'edge vs best book' column.",
      },
    ],
    relatedLinks: [
      { title: "What are Kalshi odds?", url: "/learn/what-are-kalshi-odds" },
      { title: "What is 'no-vig' and how is it calculated?", url: "/learn/no-vig-explained" },
      { title: "Kalshi vs DraftKings", url: "/compare/kalshi-vs-draftkings" },
    ],
  },
  "kalshi-vs-prediction-markets": {
    slug: "kalshi-vs-prediction-markets",
    title: "Kalshi vs Polymarket vs PredictIt",
    metaDescription:
      "How the three big US-accessible prediction markets compare on liquidity, regulation, fees, and sports coverage. Practical guide for sports bettors.",
    excerpt: "Liquidity, regulation, fees, and sports coverage compared across the three major US-accessible event-contract markets.",
    content: [
      { type: "h2", text: "Regulation" },
      {
        type: "ul",
        items: [
          "Kalshi — CFTC-regulated designated contract market (DCM). Federally licensed, operates in all 50 states for sports + non-sports.",
          "Polymarket — Operates offshore via Polymarket Limited (Cayman Islands). Currently restricted to non-US users following CFTC settlement, though VPN access is widespread.",
          "PredictIt — Operated by Victoria University of Wellington under a CFTC no-action letter. Limited markets per user; primarily political. Wound down in 2023 with phased reopening.",
        ],
      },
      { type: "h2", text: "Sports coverage" },
      {
        type: "ul",
        items: [
          "Kalshi — Full sports coverage: NBA, MLB, NHL, EPL, MLS, PGA Tour, championship futures, MVP, individual game outcomes.",
          "Polymarket — Heavy on political and macro markets; growing sports markets (NFL, NBA championships, individual game lines on majors).",
          "PredictIt — Almost entirely political; some niche markets but no live sports betting.",
        ],
      },
      { type: "h2", text: "Liquidity" },
      {
        type: "p",
        text: "Polymarket has the deepest liquidity overall (~$200M+ monthly volume), but most of it is concentrated in headline political markets. Kalshi has tighter spreads on US sports markets specifically (typically 1–3¢ on majors). PredictIt has thin liquidity outside of US presidential betting.",
      },
      { type: "h2", text: "Fees" },
      {
        type: "ul",
        items: [
          "Kalshi — Charges trading fees (0.07% per side, capped at 7¢ per share) plus settlement fees. Effective cost on a winning bet is ~1–2%.",
          "Polymarket — No trading fees; small gas fees for on-chain settlement (Polygon network, usually <$0.50).",
          "PredictIt — 10% withdrawal fee + 5% profit fee. Highest fees of the three.",
        ],
      },
      { type: "h2", text: "Bottom line for sports bettors" },
      {
        type: "p",
        text: "For US-based sports bettors, Kalshi is the practical choice — federally regulated, full sports coverage, deep liquidity. Polymarket has better political market depth but US access is technically restricted. PredictIt isn't competitive for sports.",
      },
    ],
    faq: [
      {
        question: "Why isn't Polymarket on SportsBookISH?",
        answer:
          "Polymarket's US restrictions make integration complicated, and their sports market depth is still well behind Kalshi for now. We may add it as a third reference price in the future.",
      },
    ],
    relatedLinks: [
      { title: "What are Kalshi odds?", url: "/learn/what-are-kalshi-odds" },
      { title: "How to spot edges between Kalshi and sportsbooks", url: "/learn/kalshi-edge-betting" },
    ],
  },
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return Object.keys(ARTICLES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = ARTICLES[slug];
  if (!article) return { title: "Learn — SportsBookISH" };
  return {
    title: `${article.title} | Learn — SportsBookISH`,
    description: article.metaDescription,
    alternates: { canonical: `${SITE_URL}/learn/${slug}` },
    openGraph: { title: article.title, description: article.metaDescription, url: `${SITE_URL}/learn/${slug}`, type: "article", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title: article.title, description: article.metaDescription },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = ARTICLES[slug];
  if (!article) notFound();

  const ld = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Learn", url: "/learn" },
      { name: article.title, url: `/learn/${slug}` },
    ]),
    faqLd(article.faq),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.metaDescription,
      url: `${SITE_URL}/learn/${slug}`,
      publisher: { "@type": "Organization", name: "SportsBookISH" },
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <JsonLd data={ld} />
      <MarketingNav />
      <main id="main" className="container mx-auto max-w-3xl px-4 py-16">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/learn" className="hover:text-foreground">Learn</Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground truncate">{article.title}</span>
        </nav>

        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">{article.title}</h1>
        <p className="text-lg text-muted-foreground mb-10 leading-relaxed">{article.excerpt}</p>

        <article className="space-y-4 leading-relaxed">
          {article.content.map((block, i) => {
            if (block.type === "h2") return <h2 key={i} className="text-2xl font-bold mt-8 mb-2">{block.text}</h2>;
            if (block.type === "h3") return <h3 key={i} className="text-xl font-bold mt-6 mb-2">{block.text}</h3>;
            if (block.type === "p") return <p key={i} className="text-foreground/90">{block.text}</p>;
            if (block.type === "ul") return (
              <ul key={i} className="list-disc list-inside space-y-1 text-foreground/90 pl-2">
                {(block.items || []).map((item, j) => <li key={j}>{item}</li>)}
              </ul>
            );
            return null;
          })}
        </article>

        <section className="mt-12" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-bold mb-4">FAQ</h2>
          <div className="space-y-3">
            {article.faq.map((f) => (
              <details key={f.question} className="group rounded-lg border border-border bg-card p-4">
                <summary className="cursor-pointer font-semibold text-base flex items-center justify-between gap-3">
                  <span>{f.question}</span>
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {article.relatedLinks.length > 0 && (
          <section className="mt-12 pt-8 border-t border-border" aria-labelledby="related-heading">
            <h2 id="related-heading" className="text-2xl font-bold mb-4">Related reading</h2>
            <ul className="space-y-2">
              {article.relatedLinks.map((rl) => (
                <li key={rl.url}>
                  <Link href={rl.url} className="text-emerald-500 hover:text-emerald-400 inline-flex items-center gap-1 text-sm">
                    {rl.title} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-12 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <h2 className="text-xl font-bold mb-2">See it in action</h2>
          <p className="text-sm text-muted-foreground mb-4">Live Kalshi odds vs the books across every active game.</p>
          <Link
            href="/sports"
            className="inline-flex items-center gap-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
          >
            Browse live odds <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </main>
    </div>
  );
}
