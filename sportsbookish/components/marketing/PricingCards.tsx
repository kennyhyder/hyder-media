"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TIERS, type TierKey, getPricePerMonth } from "@/lib/tiers";

export default function PricingCards() {
  const router = useRouter();
  const [loading, setLoading] = useState<TierKey | null>(null);

  async function subscribe(tier: TierKey) {
    if (tier === "free") {
      router.push("/signup");
      return;
    }
    setLoading(tier);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await r.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.requires_auth) {
        router.push(`/signup?next=/pricing&tier=${tier}`);
        return;
      }
      throw new Error(data.error || "Checkout failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3 pt-4">
      {TIERS.map((tier) => {
        const isFeatured = tier.key === "elite";
        const dollarsPerMonth = getPricePerMonth(tier);
        const totalDollars = tier.priceCents / 100;
        const isAnnual = tier.interval === "year";

        // Annual savings vs Pro monthly ($10 × 12 = $120, so $20 saved on Elite)
        const annualSavings = isAnnual ? 120 - totalDollars : 0;

        return (
          <Card
            key={tier.key}
            className={
              isFeatured
                ? "border-amber-500/40 bg-amber-500/5 relative shadow-lg shadow-amber-500/10"
                : "border-border"
            }
          >
            {isFeatured && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-600 hover:bg-amber-600 text-white">
                Best value
              </Badge>
            )}
            <CardHeader>
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>{tier.tagline}</CardDescription>
              <div className="mt-3 space-y-1">
                {tier.priceCents === 0 ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">$0</span>
                    <span className="text-muted-foreground text-sm">forever</span>
                  </div>
                ) : isAnnual ? (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">${totalDollars}</span>
                      <span className="text-muted-foreground text-sm">/year</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ${dollarsPerMonth.toFixed(2)}/mo equivalent
                      {annualSavings > 0 && <span className="text-emerald-500 font-semibold"> · saves ${annualSavings} vs Pro</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">${dollarsPerMonth}</span>
                      <span className="text-muted-foreground text-sm">/month</span>
                    </div>
                    <div className="text-xs text-muted-foreground">${(dollarsPerMonth * 12).toFixed(0)}/year if billed monthly</div>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => subscribe(tier.key)}
                disabled={loading !== null}
                className={
                  isFeatured
                    ? "w-full bg-amber-600 hover:bg-amber-500 text-white"
                    : tier.key === "pro"
                    ? "w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "w-full"
                }
                variant={isFeatured || tier.key === "pro" ? "default" : "outline"}
              >
                {loading === tier.key
                  ? "Loading…"
                  : tier.key === "free"
                  ? "Start free"
                  : isAnnual
                  ? `Subscribe — $${totalDollars}/year`
                  : `Subscribe — $${dollarsPerMonth}/mo`}
              </Button>
              <ul className="space-y-2 text-sm">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {f.included ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )}
                    <span className={f.included ? "" : "text-muted-foreground/60"}>{f.text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
