import Link from "next/link";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight, Bell, LineChart, Target, Zap } from "lucide-react";
import PricingCards from "@/components/marketing/PricingCards";
import { fetchLeagues } from "@/lib/sports-data";
import { JsonLd, itemListLd, faqLd, SITE_URL, SITE_DESCRIPTION } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kalshi Odds vs Sportsbooks — Live NBA, MLB, NHL, EPL, MLS, PGA",
  description: SITE_DESCRIPTION,
  alternates: { canonical: SITE_URL },
};

const HOMEPAGE_FAQ = [
  {
    question: "What are Kalshi odds?",
    answer:
      "Kalshi is a regulated US event-contract exchange (CFTC-licensed). Each market is a YES/NO question — e.g. 'Will the Lakers beat the Spurs?' — that trades like a stock. The current YES price (between 1¢ and 99¢) is the implied probability of the outcome. SportsBookISH converts that price into the same implied-probability format sportsbooks use, then compares it to the de-vigged consensus across DraftKings, FanDuel, BetMGM, Caesars, BetRivers and more.",
  },
  {
    question: "How does Kalshi compare to DraftKings / FanDuel / BetMGM?",
    answer:
      "Kalshi is a peer-to-peer exchange (you trade against other users, no house edge), while sportsbooks set their own lines and bake in vigorish (the 'vig'). After de-vigging book odds, Kalshi prices often diverge — sometimes Kalshi is cheaper to buy a side (positive edge), sometimes the books are. SportsBookISH highlights these gaps in real time across every game.",
  },
  {
    question: "What's a 'buy edge' on Kalshi?",
    answer:
      "Buy edge = book-consensus probability minus Kalshi probability. Positive means Kalshi is pricing the outcome cheaper than the books — a buying opportunity. Negative means Kalshi is overpriced relative to the books — a selling opportunity. Our default reference is the de-vigged median across all tracked books; Pro+ users can pick a specific home book or filter the median.",
  },
  {
    question: "Which sports does SportsBookISH cover?",
    answer:
      "NBA, MLB, NHL, English Premier League (EPL), MLS, and PGA Tour golf. Kalshi data is ingested every 5 minutes; book lines (DraftKings, FanDuel, BetMGM, Caesars, BetRivers, BetOnline, Bovada, Fanatics, LowVig, MyBookie, BetUS) refresh every 30 minutes. Golf adds DataGolf's model probabilities for an extra reference.",
  },
  {
    question: "Is this free?",
    answer:
      "Browsing live odds, the daily edge digest, and basic edge math are free without signup. A free account adds the Kalshi-fee-adjusted edge (net-of-fee — see exactly what you pocket after Kalshi's 1–2¢ per-share trading fee) and the watchlist for bookmarking teams/players. Setting custom alert rules requires Pro ($10/month). Smart preset alerts (one-click 'Big Movers', 'My Watchlist'), SMS delivery, and watchlist-filtered alerts are Elite ($100/year — cheaper than Pro on an annual basis).",
  },
  {
    question: "How often do the odds update?",
    answer:
      "Kalshi quotes refresh every 5 minutes via the official Kalshi REST API. Sportsbook lines (H2H, spread, totals) refresh every 30 minutes via The Odds API. DataGolf model probabilities (golf only) refresh every 10 minutes. Elite users get real-time alerts when a Kalshi market moves ≥3% in 15 minutes.",
  },
  {
    question: "What's the difference between books median and best book?",
    answer:
      "Books median = the middle of the de-vigged probability across all books we track for a given market. Best book = the book offering the longest American odds (lowest no-vig probability) on the YES side — meaning the cheapest place to bet YES. Comparing Kalshi to both gives you a soft target (median) and an aggressive target (best book) for finding edges.",
  },
];

export default async function Home() {
  const leagues = await fetchLeagues();

  const sportsItemList = [
    { name: "Golf — PGA Tour Kalshi Odds", url: "/golf" },
    ...leagues.map((l) => ({ name: `${l.display_name} Kalshi Odds`, url: `/sports/${l.key}` })),
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <JsonLd data={[itemListLd("Sports covered by SportsBookISH", sportsItemList), faqLd(HOMEPAGE_FAQ)]} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
        <div className="container relative mx-auto max-w-6xl px-4 py-20 md:py-28 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Zap className="h-3 w-3" aria-hidden="true" />
            <span>Live now: PGA Championship · NBA Playoffs · 41 MLB games · EPL · MLS</span>
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl md:text-6xl font-bold tracking-tight">
            Live{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
              Kalshi odds
            </span>{" "}
            vs the sportsbooks
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Compare every Kalshi event-contract price against the de-vigged consensus across DraftKings, FanDuel,
            BetMGM, Caesars, BetRivers and 6+ more books. Refreshed every 5 minutes across NBA, MLB, NHL, EPL,
            MLS, and PGA Tour golf.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className={`${buttonVariants({ size: "lg" })} bg-emerald-600 hover:bg-emerald-500 text-white`}
            >
              Start free <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/pricing" className={buttonVariants({ size: "lg", variant: "outline" })}>
              See plans
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No card required to browse live odds — click into any sport below.
          </p>
        </div>
      </section>

      <main id="main">

      {/* Sports grid — public free-tier content */}
      <section className="border-b border-border/40 bg-muted/20" aria-labelledby="sports-grid-heading">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 id="sports-grid-heading" className="text-2xl md:text-3xl font-bold tracking-tight">Live edges right now</h2>
              <p className="text-sm text-muted-foreground mt-1">Free to browse — Kalshi odds vs book consensus for every game today.</p>
            </div>
            <Link href="/sports" className="text-sm text-emerald-500 hover:text-emerald-400 inline-flex items-center gap-1">
              All sports <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Link
              href="/golf"
              className="group rounded-lg border border-border bg-card hover:bg-card/80 hover:border-emerald-500/40 p-4 transition flex flex-col items-center text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
              aria-label="Golf — PGA Tour Kalshi Odds"
            >
              <div className="text-4xl mb-2" aria-hidden="true">⛳</div>
              <div className="font-semibold text-sm">Golf</div>
              <div className="text-[10px] text-muted-foreground mt-1">PGA · DataGolf model</div>
            </Link>
            {leagues.map((l) => (
              <Link
                key={l.key}
                href={`/sports/${l.key}`}
                className="group rounded-lg border border-border bg-card hover:bg-card/80 hover:border-emerald-500/40 p-4 transition flex flex-col items-center text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
                aria-label={`${l.display_name} Kalshi Odds`}
              >
                <div className="text-4xl mb-2" aria-hidden="true">{l.icon}</div>
                <div className="font-semibold text-sm">{l.display_name}</div>
                <div className="text-[10px] text-muted-foreground mt-1 capitalize">{l.sport_category} · Kalshi + books</div>
              </Link>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/sports/movers"
              className={`${buttonVariants({ variant: "outline" })} text-sm`}
            >
              <span aria-hidden="true">📈 </span>Top movers across all sports
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border/40" aria-labelledby="features-heading">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <h2 id="features-heading" className="sr-only">How SportsBookISH works</h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Feature
              icon={<LineChart className="h-6 w-6 text-emerald-500" aria-hidden="true" />}
              title="Every market, every book"
              body="Outrights, top-5/10/20, make cut, matchups, round leaders, props on golf. Game moneylines, spreads, totals, series, and championships across NBA, MLB, NHL, EPL, MLS — with up to 11 sportsbooks side-by-side."
            />
            <Feature
              icon={<Target className="h-6 w-6 text-emerald-500" aria-hidden="true" />}
              title="Edge math, not vibes"
              body="De-vigged book consensus, DataGolf model probabilities, and Kalshi's live exchange price. Edge calculated from the buyer's perspective — pick your home book to compare against."
            />
            <Feature
              icon={<Bell className="h-6 w-6 text-emerald-500" aria-hidden="true" />}
              title="Alerts when it matters"
              body="Email + SMS the moment Kalshi crosses ±3% from consensus, or moves ≥3% in 15 min on any sport. Smart preset alerts on Elite — one-click toggles, no config."
            />
          </div>
        </div>
      </section>

      {/* FAQ — Kalshi odds explainer for AI Overview & SERP features */}
      <section className="border-b border-border/40 bg-muted/10" aria-labelledby="faq-heading">
        <div className="container mx-auto max-w-3xl px-4 py-20">
          <div className="text-center mb-12">
            <h2 id="faq-heading" className="text-3xl md:text-4xl font-bold tracking-tight">Kalshi odds explained</h2>
            <p className="mt-2 text-muted-foreground">Common questions about Kalshi, sportsbooks, and edge math.</p>
          </div>
          <div className="space-y-4">
            {HOMEPAGE_FAQ.map((f) => (
              <details key={f.question} className="group rounded-lg border border-border bg-card p-4 open:bg-card">
                <summary className="cursor-pointer font-semibold text-base flex items-center justify-between gap-3">
                  <span>{f.question}</span>
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-b border-border/40" aria-labelledby="pricing-heading">
        <div className="container mx-auto max-w-6xl px-4 py-20">
          <div className="text-center mb-12">
            <h2 id="pricing-heading" className="text-3xl md:text-4xl font-bold tracking-tight">Simple, honest pricing</h2>
            <p className="mt-2 text-muted-foreground">Cancel anytime. No long-term commitment.</p>
          </div>
          <PricingCards />
        </div>
      </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border/40" aria-label="Site footer">
        <div className="container mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div>
              <div className="font-semibold text-foreground mb-2">Sports</div>
              <ul className="space-y-1">
                <li><Link href="/golf" className="hover:text-foreground">Golf / PGA Kalshi odds</Link></li>
                {leagues.map((l) => (
                  <li key={l.key}>
                    <Link href={`/sports/${l.key}`} className="hover:text-foreground">{l.display_name} Kalshi odds</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground mb-2">Product</div>
              <ul className="space-y-1">
                <li><Link href="/sports" className="hover:text-foreground">All sports</Link></li>
                <li><Link href="/sports/movers" className="hover:text-foreground">Top movers</Link></li>
                <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground mb-2">Account</div>
              <ul className="space-y-1">
                <li><Link href="/signup" className="hover:text-foreground">Sign up free</Link></li>
                <li><Link href="/login" className="hover:text-foreground">Log in</Link></li>
                <li><Link href="/dashboard" className="hover:text-foreground">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground mb-2">About</div>
              <p className="text-xs leading-relaxed">
                SportsBookISH is an information service that compares Kalshi event-contract prices to US sportsbook consensus.
                We do not accept wagers. Built by Hyder Media.
              </p>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-2 pt-6 border-t border-border/40">
            <div>© 2026 SportsBookISH — built by Hyder Media</div>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
              <Link href="/login" className="hover:text-foreground">Log in</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-3">{icon}</div>
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
