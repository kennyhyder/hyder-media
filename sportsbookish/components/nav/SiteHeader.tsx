import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineChart } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/nav/UserMenu";
import { TIER_BY_KEY, type TierKey } from "@/lib/tiers";
import { isAdminEmail } from "@/lib/admin";

// One header for every page on the site. Auth-aware:
// - Anonymous: Sports / Compare / Learn / Pricing · Log in · Sign up free
// - Free: Sports / Golf / Movers / Pricing · tier · user menu
// - Pro+: + Alerts · Watchlist
// - Elite: + Bet Tracker
// - Admin: + Admin link inside user menu
//
// Mobile: trims to Sports + Pricing visible; rest collapse into the user menu.

export default async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let tier: TierKey = "free";
  if (user) {
    const { data: sub } = await supabase
      .from("sb_subscriptions")
      .select("tier")
      .eq("user_id", user.id)
      .maybeSingle();
    tier = (sub?.tier || "free") as TierKey;
  }

  const isAnonymous = !user;
  const isElite = tier === "elite";
  const isPaid = tier !== "free";
  const isAdmin = isAdminEmail(user?.email);
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-[1800px] items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-1 min-w-0">
          <Link href={isAnonymous ? "/" : "/dashboard"} className="flex items-center gap-2 font-semibold mr-3 shrink-0">
            <LineChart className="h-5 w-5 text-emerald-500" aria-hidden="true" />
            <span className="text-lg tracking-tight">SportsBook<span className="text-emerald-500">ISH</span></span>
          </Link>
          <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="Primary">
            <Link href="/sports" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0`}>Sports</Link>
            <Link href="/golf" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden sm:inline-flex`}>Golf</Link>
            <Link href="/sports/movers" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden md:inline-flex`}>Movers</Link>
            {isPaid && (
              <Link href="/alerts" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden md:inline-flex`}>Alerts</Link>
            )}
            {isElite && (
              <Link href="/bets" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden lg:inline-flex`}>Bets</Link>
            )}
            {isAnonymous && (
              <>
                <Link href="/compare" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden lg:inline-flex`}>Compare</Link>
                <Link href="/learn" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0 hidden lg:inline-flex`}>Learn</Link>
              </>
            )}
            <Link href="/pricing" className={`${buttonVariants({ variant: "ghost", size: "sm" })} shrink-0`}>Pricing</Link>
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAnonymous ? (
            <>
              <Link href="/login" className={`${buttonVariants({ variant: "ghost", size: "sm" })} hidden sm:inline-flex`}>Log in</Link>
              <Link href="/signup" className={`${buttonVariants({ size: "sm" })} bg-emerald-600 hover:bg-emerald-500 text-white`}>Start free</Link>
            </>
          ) : (
            <>
              <Badge
                variant="outline"
                className={
                  isElite
                    ? "border-amber-500/40 text-amber-500 hidden sm:inline-flex"
                    : isPaid
                    ? "border-emerald-500/40 text-emerald-500 hidden sm:inline-flex"
                    : "border-border text-muted-foreground hidden sm:inline-flex"
                }
              >
                {tierInfo.name}
              </Badge>
              <UserMenu email={user!.email || ""} tier={tier} isAdmin={isAdmin} />
            </>
          )}
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}
