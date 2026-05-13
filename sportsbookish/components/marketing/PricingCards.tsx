"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TIERS, type TierKey } from "@/lib/tiers";

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
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {TIERS.map((tier) => {
        const isFeatured = tier.key === "pro";
        return (
          <Card
            key={tier.key}
            className={
              isFeatured
                ? "border-emerald-500/40 bg-emerald-500/5 relative shadow-lg shadow-emerald-500/10"
                : "border-border"
            }
          >
            {isFeatured && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 hover:bg-emerald-600 text-white">
                Most popular
              </Badge>
            )}
            <CardHeader>
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>{tier.tagline}</CardDescription>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold">${tier.priceMonthly}</span>
                <span className="text-muted-foreground text-sm">/month</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => subscribe(tier.key)}
                disabled={loading !== null}
                className={
                  isFeatured
                    ? "w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "w-full"
                }
                variant={isFeatured ? "default" : "outline"}
              >
                {loading === tier.key
                  ? "Loading…"
                  : tier.key === "free"
                  ? "Start free"
                  : `Subscribe — $${tier.priceMonthly}/mo`}
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
