import PricingCards from "@/components/marketing/PricingCards";

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <main className="container mx-auto max-w-6xl px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-3 text-muted-foreground">Start free, upgrade when you want every market and live alerts.</p>
        </div>
        <PricingCards />
        <div className="mt-16 max-w-2xl mx-auto space-y-4 text-sm text-muted-foreground">
          <div>
            <h3 className="font-semibold text-foreground mb-1">Can I cancel anytime?</h3>
            <p>Yes — manage your subscription via the customer portal. Cancellation is immediate; you keep access through the end of the current billing period.</p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">What sports are covered?</h3>
            <p>PGA Tour golf is fully live today (this week: PGA Championship). NBA Playoffs, MLB, and soccer come next.</p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">Does SportsBookish accept bets?</h3>
            <p>No. SportsBookish is an information service — it shows you where prices differ across Kalshi and licensed sportsbooks. You place bets at the books or on Kalshi directly.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
