import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TIER_BY_KEY, type TierKey } from "@/lib/tiers";
import { LineChart, Settings, LogOut } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier, status, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const tier = (sub?.tier || "free") as TierKey;
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <LineChart className="h-5 w-5 text-emerald-500" />
            <span className="text-lg tracking-tight">SportsBookish</span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              {tierInfo.name}
            </Badge>
            <Link href="/settings" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Settings className="h-4 w-4" />
            </Link>
            <form action="/api/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold mb-2">Welcome to SportsBookish</h1>
        <p className="text-muted-foreground mb-8">{user.email}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Your plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-2xl font-bold">{tierInfo.name}</div>
                <div className="text-sm text-muted-foreground">{tierInfo.tagline}</div>
              </div>
              {tier === "free" ? (
                <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                  Upgrade to Pro
                </Link>
              ) : (
                <div className="text-sm text-muted-foreground">
                  ${tierInfo.priceMonthly}/month
                  {sub?.current_period_end && (
                    <> · renews {new Date(sub.current_period_end).toLocaleDateString()}</>
                  )}
                  {sub?.cancel_at_period_end && <> · cancelling at period end</>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Golf — PGA Championship 2026</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Live ingestion every 5 min. {tier === "free" ? "Free tier shows winner lines only." : "All markets available."}
              </p>
              <Link href="/golf" className={buttonVariants({ variant: "outline" })}>Open golf dashboard</Link>
            </CardContent>
          </Card>
        </div>

        <div className="mt-10 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            🚧 The golf data view, alerts feed, and player detail pages are being migrated here from the legacy{" "}
            <Link href="https://hyder.me/golfodds" className="underline">hyder.me/golfodds</Link> — coming in the next push.
          </p>
        </div>
      </main>
    </div>
  );
}
