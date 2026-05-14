import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TIER_BY_KEY, type TierKey } from "@/lib/tiers";
import { LineChart, Settings, LogOut } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { fetchLeagues } from "@/lib/sports-data";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: sub }, leagues] = await Promise.all([
    supabase
      .from("sb_subscriptions")
      .select("tier, status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle(),
    fetchLeagues(),
  ]);

  const tier = (sub?.tier || "free") as TierKey;
  const tierInfo = TIER_BY_KEY[tier];
  const isAdmin = isAdminEmail(user.email);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <LineChart className="h-5 w-5 text-emerald-500" />
            <span className="text-lg tracking-tight">SportsBook<span className="text-emerald-500">ISH</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              {tierInfo.name}
            </Badge>
            <Link href="/settings" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <Settings className="h-4 w-4" />
            </Link>
            <ThemeToggle compact />
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
                  {tierInfo.interval === "year" ? `$${tierInfo.priceCents / 100}/year` : `$${tierInfo.priceCents / 100}/month`}
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
              <Link href="/golf" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>Open golf dashboard</Link>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sports</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Link href="/golf" className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 hover:border-emerald-500/40 p-4 transition">
              <div className="text-2xl mb-2">⛳</div>
              <div className="font-semibold">Golf</div>
              <div className="text-xs text-muted-foreground mt-1">PGA Tour · DataGolf model</div>
            </Link>
            {leagues.map((l) => (
              <Link key={l.key} href={`/sports/${l.key}`} className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 hover:border-emerald-500/40 p-4 transition">
                <div className="text-2xl mb-2">{l.icon}</div>
                <div className="font-semibold">{l.display_name}</div>
                <div className="text-xs text-muted-foreground mt-1 capitalize">{l.sport_category} · Kalshi + books</div>
              </Link>
            ))}
          </div>

          <div className="text-xs uppercase tracking-wide text-muted-foreground mt-6 mb-2">Tools</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Link href="/sports/movers" className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 p-4 transition">
              <div className="text-2xl mb-2">📈</div>
              <div className="font-semibold">Top movers</div>
              <div className="text-xs text-muted-foreground mt-1">Recent moves across all sports</div>
            </Link>
            <Link href="/bets" className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 p-4 transition">
              <div className="text-2xl mb-2">📊</div>
              <div className="font-semibold flex items-center gap-2">Bet Tracker {tier !== "elite" && <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Elite</Badge>}</div>
              <div className="text-xs text-muted-foreground mt-1">Log bets · Skill Score · CLV tracking</div>
            </Link>
            <Link href={tier === "elite" ? "/alerts" : "/pricing"} className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 p-4 transition">
              <div className="text-2xl mb-2">⚡</div>
              <div className="font-semibold flex items-center gap-2">Alerts {tier !== "elite" && <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Elite</Badge>}</div>
              <div className="text-xs text-muted-foreground mt-1">Live edges via email + SMS</div>
            </Link>
            <Link href="/sports" className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 p-4 transition">
              <div className="text-2xl mb-2">🌐</div>
              <div className="font-semibold">All sports hub</div>
              <div className="text-xs text-muted-foreground mt-1">League index</div>
            </Link>
            <Link href="/settings" className="rounded-lg border border-border bg-muted/10 hover:bg-muted/30 p-4 transition">
              <div className="text-2xl mb-2">⚙️</div>
              <div className="font-semibold flex items-center gap-2">Settings {tier === "free" && <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Pro</Badge>}</div>
              <div className="text-xs text-muted-foreground mt-1">Home book · alerts · billing</div>
            </Link>
          </div>

          {isAdmin && (
            <>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mt-6 mb-2">Admin</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <Link href="/admin" className="rounded-lg border border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 p-4 transition">
                  <div className="text-2xl mb-2">👥</div>
                  <div className="font-semibold">Users</div>
                  <div className="text-xs text-muted-foreground mt-1">View · change tier · delete</div>
                </Link>
                <Link href="/admin/invites" className="rounded-lg border border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 p-4 transition">
                  <div className="text-2xl mb-2">🎁</div>
                  <div className="font-semibold">Invite codes</div>
                  <div className="text-xs text-muted-foreground mt-1">Create · disable · track redemptions</div>
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
