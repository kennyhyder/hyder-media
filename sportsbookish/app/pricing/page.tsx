import Link from "next/link";
import PricingCards from "@/components/marketing/PricingCards";
import { Card, CardContent } from "@/components/ui/card";
import { API_PLANS } from "@/lib/tiers";
import { Check } from "lucide-react";

export default function PricingPage() {
  const apiDemo = API_PLANS.find((p) => p.key === "free")!;
  const apiMonthly = API_PLANS.find((p) => p.key === "api_monthly")!;
  const apiAnnual = API_PLANS.find((p) => p.key === "api_annual")!;
  const apiEnterprise = API_PLANS.find((p) => p.key === "enterprise")!;

  return (
    <div className="min-h-screen">
      <main className="container mx-auto max-w-6xl px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-3 text-muted-foreground">Start free, upgrade when you want every market and live alerts.</p>
        </div>

        <PricingCards />

        {/* API add-on */}
        <section id="api" className="mt-20 scroll-mt-20">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Add-on: Developer API</h2>
            <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
              Independent of the UI tiers above. Build apps, models, or research projects on the same data that powers SportsBookISH. <Link href="/api/docs" className="text-emerald-500 hover:underline">Docs + live demo →</Link>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <ApiCard plan={apiDemo}    cta={{ label: "Use shared key", href: "/api/docs" }} />
            <ApiCard plan={apiMonthly} cta={{ label: "Subscribe — $50/mo", href: "/signup?api=monthly" }} highlight />
            <ApiCard plan={apiAnnual}  cta={{ label: "Subscribe — $500/yr", href: "/signup?api=annual" }} />
            <ApiCard plan={apiEnterprise} cta={{ label: "Contact for pricing", href: "/contact?topic=api-enterprise" }} />
          </div>
        </section>

        <div className="mt-16 max-w-2xl mx-auto space-y-4 text-sm text-muted-foreground">
          <div>
            <h3 className="font-semibold text-foreground mb-1">Can I cancel anytime?</h3>
            <p>Yes — manage your subscription via the customer portal. Cancellation is immediate; you keep access through the end of the current billing period.</p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">Can I have both a UI subscription and the API add-on?</h3>
            <p>Yes — they&apos;re independent. Subscribe to Pro for the web app + the API add-on to build on the data. Two separate Stripe subscriptions, billed independently.</p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">What sports are covered?</h3>
            <p>PGA Tour golf, NFL, NBA, MLB, NHL, EPL, MLS, UEFA Champions League, FIFA World Cup. Live odds refresh every 5 minutes.</p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">Does SportsBookISH accept bets?</h3>
            <p>No. SportsBookISH is an information service — it shows you where prices differ across Kalshi, Polymarket, and licensed sportsbooks. You place bets at the books or on Kalshi directly.</p>
          </div>
        </div>
      </main>
    </div>
  );
}

function ApiCard({ plan, cta, highlight }: { plan: typeof API_PLANS[number]; cta: { label: string; href: string }; highlight?: boolean }) {
  const priceLabel =
    plan.priceCents === 0 && plan.key === "free" ? "Free" :
    plan.priceCents === 0 ? "Custom" :
    plan.interval === "month" ? `$${(plan.priceCents / 100).toLocaleString()}/mo` :
    `$${(plan.priceCents / 100).toLocaleString()}/yr`;
  const quotaLabel = plan.monthlyQuota
    ? `${plan.monthlyQuota.toLocaleString()} req/mo`
    : "Custom quota";
  return (
    <Card className={highlight ? "border-emerald-500/40 bg-emerald-500/5" : ""}>
      <CardContent className="p-5 flex flex-col h-full">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{plan.name}</div>
        <div className="text-3xl font-bold mt-1">{priceLabel}</div>
        <div className="text-sm font-mono text-emerald-500 mt-1">{quotaLabel}</div>
        <p className="text-xs text-muted-foreground mt-2">{plan.tagline}</p>
        <ul className="text-xs space-y-1.5 mt-4 mb-4 flex-1">
          {plan.features.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Check className="h-3.5 w-3.5 mt-0.5 text-emerald-500 shrink-0" aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Link href={cta.href} className={`mt-auto block text-center rounded px-3 py-2 text-sm font-semibold ${highlight ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "border border-border hover:border-emerald-500/40"}`}>
          {cta.label}
        </Link>
      </CardContent>
    </Card>
  );
}
