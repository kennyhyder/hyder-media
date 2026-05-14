import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Check, X } from "lucide-react";
import { JsonLd, breadcrumbLd, faqLd, SITE_URL } from "@/lib/seo";

interface BookProfile {
  slug: string;
  name: string;
  emoji: string;
  intro: string;
  strengths: string[];
  weaknesses: string[];
  kalshiAdvantages: string[];
  faq: { question: string; answer: string }[];
}

const BOOKS: Record<string, BookProfile> = {
  draftkings: {
    slug: "draftkings",
    name: "DraftKings",
    emoji: "🟢",
    intro:
      "DraftKings is the largest US legal sportsbook, with sharp pricing on major sports (NBA, NFL, MLB) and broad coverage across futures and props. They have aggressive promo pricing during peak events.",
    strengths: [
      "Tightest spread / total lines among public US books on the NBA & NFL",
      "Wide market coverage — every game, every player prop",
      "Fast cash-out and live betting features",
    ],
    weaknesses: [
      "Vig averages 4–5% (Kalshi has none — peer-to-peer)",
      "Limits aggressive winners faster than Kalshi (which never limits)",
      "Lines slow to move on smaller events vs market consensus",
    ],
    kalshiAdvantages: [
      "No vig — peer-to-peer pricing means you don't pay the house margin",
      "Often cheaper on derivatives (live championship futures, MVP)",
      "CFTC-regulated as an event-contract exchange — federal oversight vs state-by-state sportsbook licensing",
      "No limits — bet as much as the order book supports",
    ],
    faq: [
      {
        question: "Is Kalshi legal in states where DraftKings isn't?",
        answer:
          "Kalshi is a CFTC-licensed event-contract exchange and is legal nationwide for the markets they list. DraftKings requires individual state licensing. This matters for users in states like California, Texas, or Hawaii where DraftKings isn't available.",
      },
      {
        question: "Why are DraftKings and Kalshi odds different?",
        answer:
          "DraftKings sets prices algorithmically and bakes in 4–5% vig to make a margin regardless of outcome. Kalshi is a peer-to-peer marketplace where prices float based on user supply and demand. The two pricing mechanisms diverge — sometimes by 5%+ on the same outcome.",
      },
      {
        question: "Can I arbitrage Kalshi vs DraftKings?",
        answer:
          "Yes, when Kalshi YES + DraftKings NO (or vice versa) combine to less than 100% in implied probability, you can lock a risk-free return. SportsBookISH flags these gaps automatically. Arbitrage requires you to be funded on both platforms.",
      },
    ],
  },
  fanduel: {
    slug: "fanduel",
    name: "FanDuel",
    emoji: "🔵",
    intro:
      "FanDuel grew out of daily fantasy sports and is now the second-largest US sportsbook by revenue. Known for parlay-heavy product, slight favorites bias on primetime games.",
    strengths: [
      "Best parlay product (Same Game Parlays especially)",
      "Strong live betting interface",
      "Frequent risk-free bet promos for new users",
    ],
    weaknesses: [
      "Slightly heavier vig than DraftKings (typically 5–6% on moneylines)",
      "Limits sharper than DraftKings — gets you off the book faster",
      "Slower to move primetime NBA/NFL lines than the sharp consensus",
    ],
    kalshiAdvantages: [
      "No vig and no limits",
      "Tighter prices on futures (championship winners, MVP, etc.)",
      "Federally regulated under the CFTC, not state-by-state",
    ],
    faq: [
      {
        question: "Why is FanDuel often more expensive than Kalshi?",
        answer:
          "FanDuel typically prices 5–6% vig into moneyline markets. Kalshi has no vig (peer-to-peer). On a 50/50 game, FanDuel charges ~-110 each side; Kalshi might trade 49¢/51¢. Over hundreds of bets, that vig adds up.",
      },
      {
        question: "What about FanDuel Same Game Parlays?",
        answer:
          "SGPs are a sportsbook-specific product — Kalshi doesn't offer them. If you want SGP exposure, FanDuel is the place. But the typical price for an SGP is well above fair value, making them poor +EV plays. Single-leg moneylines and totals are where Kalshi vs FanDuel comparison matters.",
      },
    ],
  },
  betmgm: {
    slug: "betmgm",
    name: "BetMGM",
    emoji: "🟡",
    intro:
      "BetMGM blends MGM's Vegas heritage with online sportsbook tech. Often runs promo-boosted pricing that creates the softest side of the books consensus.",
    strengths: [
      "Frequent boosted markets (often the cheapest book on any given moneyline)",
      "Rewards crossover with MGM Rewards (Vegas perks)",
      "Strong NBA / college basketball coverage",
    ],
    weaknesses: [
      "Wide vig outside of promo periods",
      "Limits and bonus restrictions kick in early",
      "Mobile UX trails DraftKings/FanDuel",
    ],
    kalshiAdvantages: [
      "Consistent no-vig pricing (not promo-dependent)",
      "No limit on winning users",
      "Better coverage on event-contract futures (e.g. MVP) than BetMGM's traditional book",
    ],
    faq: [
      {
        question: "Is BetMGM ever cheaper than Kalshi?",
        answer:
          "Yes, on promo-boosted markets BetMGM regularly prices below the Kalshi line. SportsBookISH's 'best book' column tracks this automatically — when BetMGM is the cheapest book and Kalshi is more expensive, that's a sell signal on Kalshi.",
      },
    ],
  },
  caesars: {
    slug: "caesars",
    name: "Caesars",
    emoji: "🟣",
    intro:
      "Caesars Sportsbook (formerly William Hill US) leverages the Caesars casino brand. Known for slow line movements on moneylines and aggressive parlay payouts.",
    strengths: [
      "Strong parlay boosts",
      "Caesars Rewards crossover (Vegas perks)",
      "Reasonable limits for non-sharps",
    ],
    weaknesses: [
      "Moneyline lines move slowly — often the stalest side of the consensus",
      "Heavier vig than DraftKings/FanDuel",
      "Limited live in-game markets",
    ],
    kalshiAdvantages: [
      "Real-time pricing (Kalshi orderbook updates by the second)",
      "No-vig pricing means Caesars's tax shows clearly when compared",
    ],
    faq: [
      {
        question: "Why does SportsBookISH show 'Caesars' for the William Hill key?",
        answer:
          "The Odds API uses 'williamhill_us' as the legacy key (Caesars acquired William Hill US). We normalize that to 'caesars' for display consistency.",
      },
    ],
  },
  betrivers: {
    slug: "betrivers",
    name: "BetRivers",
    emoji: "🔴",
    intro:
      "BetRivers is a regional book operating in 15+ states, owned by Rush Street Interactive. Often the best-line book on baseball moneylines and small-market hockey.",
    strengths: [
      "Frequently the cheapest book on MLB moneylines",
      "iRush Rewards (slot crossover)",
      "Decent boosts on regional teams",
    ],
    weaknesses: [
      "Smaller market depth than DraftKings/FanDuel",
      "Live betting UI feels dated",
      "Limit aggressive winners",
    ],
    kalshiAdvantages: [
      "Wider market depth (every Kalshi user is liquidity)",
      "No vig — consistent across every market type",
    ],
    faq: [
      {
        question: "Is BetRivers good for arbing against Kalshi?",
        answer:
          "BetRivers's slower lines on regional markets sometimes create wide gaps vs Kalshi — good arb opportunities on MLB and NHL specifically.",
      },
    ],
  },
  fanatics: {
    slug: "fanatics",
    name: "Fanatics",
    emoji: "⚫",
    intro:
      "Fanatics Sportsbook launched in 2023 with aggressive new-user pricing and is now operating in 20+ states. Often boosts home-team moneylines.",
    strengths: [
      "Frequent boosts on popular teams",
      "Cross-promotion with the Fanatics merchandise ecosystem",
      "Reasonable limits during launch period",
    ],
    weaknesses: [
      "Newest operator — line accuracy still improving",
      "Limited futures and prop coverage vs DraftKings",
      "Mobile app stability issues at launch",
    ],
    kalshiAdvantages: [
      "Mature orderbook with deeper liquidity than Fanatics on niche markets",
      "No promo dependency — every line is fair-vig",
    ],
    faq: [
      {
        question: "Is Fanatics worth tracking against Kalshi?",
        answer:
          "Yes — Fanatics's home-team boosts often create the cheapest book on the home side, while Kalshi sets a market-driven price. That gap is one of the more reliable buy-edges SportsBookISH flags.",
      },
    ],
  },
};

interface PageProps {
  params: Promise<{ book: string }>;
}

export async function generateStaticParams() {
  return Object.keys(BOOKS).map((book) => ({ book }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { book } = await params;
  const profile = BOOKS[book];
  if (!profile) return { title: "Compare Kalshi to sportsbooks" };
  const title = `Kalshi vs ${profile.name} — Live Odds Comparison`;
  const description = `${profile.intro.slice(0, 140)}... Compare Kalshi event-contract prices against ${profile.name} in real time across NBA, MLB, NHL, EPL, MLS and PGA.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/compare/kalshi-vs-${book}` },
    openGraph: { title, description, url: `${SITE_URL}/compare/kalshi-vs-${book}`, siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ComparePage({ params }: PageProps) {
  const { book } = await params;
  const profile = BOOKS[book];
  if (!profile) notFound();

  const ld = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
      { name: `Kalshi vs ${profile.name}`, url: `/compare/kalshi-vs-${profile.slug}` },
    ]),
    faqLd(profile.faq),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <JsonLd data={ld} />
      <main id="main" className="container mx-auto max-w-3xl px-4 py-16">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/compare" className="hover:text-foreground">Compare</Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground">Kalshi vs {profile.name}</span>
        </nav>

        <div className="flex items-center gap-3 mb-3">
          <span className="text-5xl" aria-hidden="true">{profile.emoji}</span>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Kalshi vs {profile.name}
          </h1>
        </div>
        <p className="text-lg text-muted-foreground mb-10 leading-relaxed">{profile.intro}</p>

        <div className="grid md:grid-cols-2 gap-4 mb-10">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">{profile.name} strengths</h2>
              <ul className="space-y-2 text-sm">
                {profile.strengths.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">{profile.name} weaknesses</h2>
              <ul className="space-y-2 text-sm">
                {profile.weaknesses.map((w) => (
                  <li key={w} className="flex items-start gap-2">
                    <X className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-10 border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-5">
            <h2 className="text-lg font-bold mb-3">Where Kalshi beats {profile.name}</h2>
            <ul className="space-y-2 text-sm">
              {profile.kalshiAdvantages.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-bold mb-4">FAQ: Kalshi vs {profile.name}</h2>
          <div className="space-y-3">
            {profile.faq.map((f) => (
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

        <div className="mt-12 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <h2 className="text-xl font-bold mb-2">See live Kalshi vs {profile.name} edges</h2>
          <p className="text-sm text-muted-foreground mb-4">Browse every active game across NBA, MLB, NHL, EPL, MLS and golf. No card required.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link
              href="/sports"
              className="inline-flex items-center gap-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
            >
              Browse live odds <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/compare"
              className="inline-flex items-center gap-2 rounded border border-border hover:bg-muted px-5 py-2.5"
            >
              Compare other books
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
