import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";

interface Props {
  feature: string;                 // What's being unlocked, e.g. "Top-5 lines"
  description?: string;
  isAnonymous: boolean;            // Show signup CTA instead of upgrade for anonymous
  requiredTier?: "pro" | "elite";
  next?: string;                   // Where to land after signup
  variant?: "card" | "inline";
}

const TIER_PRICE = { pro: "$19/mo", elite: "$39/mo" } as const;

export default function PaywallCard({ feature, description, isAnonymous, requiredTier = "pro", next, variant = "card" }: Props) {
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";
  const tierLabel = requiredTier === "elite" ? "Elite" : "Pro";
  const price = TIER_PRICE[requiredTier];

  if (variant === "inline") {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex items-center gap-3">
        <Lock className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">{feature}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
        {isAnonymous ? (
          <Link href={signupHref} className={`${buttonVariants({ size: "sm" })} bg-emerald-600 hover:bg-emerald-500 text-white`}>
            Sign up free
          </Link>
        ) : (
          <Link href="/pricing" className={`${buttonVariants({ size: "sm" })} bg-emerald-600 hover:bg-emerald-500 text-white`}>
            Upgrade · {price}
          </Link>
        )}
      </div>
    );
  }

  return (
    <Card className="max-w-md w-full text-center mx-auto">
      <CardHeader>
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
          <Lock className="h-6 w-6 text-amber-500" />
        </div>
        <CardTitle>{feature}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {isAnonymous ? (
          <>
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Free signup</strong> gets you live alerts and saved preferences.
              <br /><strong className="text-foreground">{tierLabel}</strong> ({price}) unlocks this view.
            </p>
            <div className="flex gap-2 justify-center">
              <Link href={signupHref} className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                Sign up free
              </Link>
              <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
                See plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Upgrade to <strong className="text-foreground">{tierLabel}</strong> ({price}) to unlock this view.
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                Upgrade · {price}
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
