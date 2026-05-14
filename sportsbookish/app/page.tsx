import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight, Bell, LineChart, Target, Zap } from "lucide-react";
import MarketingNav from "@/components/nav/MarketingNav";
import PricingCards from "@/components/marketing/PricingCards";
import { fetchLeagues } from "@/lib/sports-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const leagues = await fetchLeagues();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
        <div className="container relative mx-auto max-w-6xl px-4 py-20 md:py-28 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Zap className="h-3 w-3" />
            <span>Live now: PGA Championship · NBA Playoffs · 41 MLB games · EPL · MLS</span>
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl md:text-6xl font-bold tracking-tight">
            Find the edge between{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
              Kalshi
            </span>{" "}
            and the books — live.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Compare every event-contract price on Kalshi against sportsbook consensus every 5 minutes.
            Get alerted the moment a mispricing crosses your threshold across golf, NBA, MLB, NHL, and soccer.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className={`${buttonVariants({ size: "lg" })} bg-emerald-600 hover:bg-emerald-500 text-white`}
            >
              Start free <ArrowRight className="ml-1 h-4 w-4" />
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

      {/* Sports grid — public free-tier content */}
      <section className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Live edges right now</h2>
              <p className="text-sm text-muted-foreground mt-1">Free to browse — Kalshi vs book consensus across every sport we cover.</p>
            </div>
            <Link href="/sports" className="text-sm text-emerald-500 hover:text-emerald-400 inline-flex items-center gap-1">
              All sports <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Link
              href="/golf"
              className="group rounded-lg border border-border bg-card hover:bg-card/80 hover:border-emerald-500/40 p-4 transition flex flex-col items-center text-center"
            >
              <div className="text-4xl mb-2">⛳</div>
              <div className="font-semibold text-sm">Golf</div>
              <div className="text-[10px] text-muted-foreground mt-1">PGA · DataGolf model</div>
            </Link>
            {leagues.map((l) => (
              <Link
                key={l.key}
                href={`/sports/${l.key}`}
                className="group rounded-lg border border-border bg-card hover:bg-card/80 hover:border-emerald-500/40 p-4 transition flex flex-col items-center text-center"
              >
                <div className="text-4xl mb-2">{l.icon}</div>
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
              📈 Top movers across all sports
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border/40">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Feature
              icon={<LineChart className="h-6 w-6 text-emerald-500" />}
              title="Every market, every book"
              body="Outrights, top-5/10/20, make cut, matchups, round leaders, props on golf. Game moneylines, series, and championships across NBA, MLB, NHL, EPL, MLS — with up to 14 sportsbooks side-by-side."
            />
            <Feature
              icon={<Target className="h-6 w-6 text-emerald-500" />}
              title="Edge math, not vibes"
              body="De-vigged book consensus, DataGolf model probabilities, and Kalshi's live exchange price. Edge calculated from the buyer's perspective — pick your home book to compare against."
            />
            <Feature
              icon={<Bell className="h-6 w-6 text-emerald-500" />}
              title="Alerts when it matters"
              body="Email + SMS the moment Kalshi crosses ±3% from consensus on golf, or moves ≥3% in 15 min on any sport. Custom thresholds on Elite."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-b border-border/40">
        <div className="container mx-auto max-w-6xl px-4 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Simple, honest pricing</h2>
            <p className="mt-2 text-muted-foreground">Cancel anytime. No long-term commitment.</p>
          </div>
          <PricingCards />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="container mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground flex flex-col md:flex-row items-center justify-between gap-2">
          <div>© 2026 SportsBookish — built by Hyder Media</div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
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
