import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight, Bell, LineChart, Target, Zap } from "lucide-react";
import MarketingNav from "@/components/nav/MarketingNav";
import PricingCards from "@/components/marketing/PricingCards";

export default function Home() {
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
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border/40">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Feature
              icon={<LineChart className="h-6 w-6 text-emerald-500" />}
              title="Every market, every book"
              body="Outrights, top-5/10/20, make cut, matchups, round leaders, props on golf. Game moneylines, series, and championships across NBA, MLB, NHL, EPL, MLS — with 14 sportsbooks side-by-side on golf."
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
