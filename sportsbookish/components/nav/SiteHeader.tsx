import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Trophy, Activity, TrendingUp, BookOpen, GitCompare,
  Bell, Star, BarChart3, LayoutDashboard, Sparkles,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/nav/UserMenu";
import NavDropdown, { type NavDropdownSection } from "@/components/nav/NavDropdown";
import { fetchLeagues } from "@/lib/sports-data";
import { TIER_BY_KEY, type TierKey } from "@/lib/tiers";
import { isAdminEmail } from "@/lib/admin";

// Faceted-dropdown nav. Server component fetches user + league list.
//   Sports ▾   →   live league cards (NBA, MLB, NHL, EPL, MLS, Golf) + All Sports + Top Movers
//   Tools ▾    →   tier-aware: Compare/Learn (anon) or Watchlist/Alerts/Bets (signed-in)
//   Pricing
//   right side: tier badge + UserMenu + theme toggle (anonymous: Log in + Start free + theme)

const LEAGUE_ICONS: Record<string, string> = {
  nba: "🏀", mlb: "⚾", nhl: "🏒", epl: "⚽", mls: "⚽",
};

export default async function SiteHeader() {
  // Resilient resolution — any error in user / tier / leagues must NOT
  // crash the layout. We fall back to anonymous + empty leagues.
  let userEmail: string | null = null;
  let tier: TierKey = "free";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userEmail = user.email || null;
      const { data: sub } = await supabase
        .from("sb_subscriptions")
        .select("tier")
        .eq("user_id", user.id)
        .maybeSingle();
      tier = (sub?.tier || "free") as TierKey;
    }
  } catch {}

  const isAnonymous = !userEmail;
  const isElite = tier === "elite";
  const isPaid = tier !== "free";
  const isAdmin = isAdminEmail(userEmail);
  const tierInfo = TIER_BY_KEY[tier];

  let leagues: Awaited<ReturnType<typeof fetchLeagues>> = [];
  try { leagues = await fetchLeagues(); } catch {}

  // SPORTS dropdown — show all leagues as facets including golf
  const sportsSections: NavDropdownSection[] = [
    {
      heading: "Leagues",
      items: [
        { label: "Golf", href: "/golf", description: "PGA Tour · DataGolf model" },
        ...leagues.map((l) => ({
          label: l.display_name,
          href: `/sports/${l.key}`,
          description: `${LEAGUE_ICONS[l.key] || ""} ${l.sport_category}`,
        })),
      ],
    },
    {
      heading: "More",
      items: [
        { label: "All sports", href: "/sports", description: "League index", icon: <Trophy className="h-4 w-4" /> },
        { label: "Top movers", href: "/sports/movers", description: "Live Kalshi line moves ≥2%", icon: <TrendingUp className="h-4 w-4" /> },
      ],
    },
  ];

  // TOOLS dropdown — tier-aware
  const toolsItems: NavDropdownSection[] = [];
  if (isAnonymous) {
    toolsItems.push({
      heading: "Resources",
      items: [
        { label: "Compare sportsbooks", href: "/compare", description: "Kalshi vs DraftKings, FanDuel & more", icon: <GitCompare className="h-4 w-4" /> },
        { label: "Learn", href: "/learn", description: "Kalshi odds explained · no-vig math", icon: <BookOpen className="h-4 w-4" /> },
      ],
    });
  } else {
    toolsItems.push({
      heading: "Your stuff",
      items: [
        { label: "Dashboard", href: "/dashboard", description: "Account hub", icon: <LayoutDashboard className="h-4 w-4" /> },
        ...(isPaid ? [{ label: "Alerts", href: "/alerts", description: "Custom rules + smart presets", icon: <Bell className="h-4 w-4" /> }] : []),
        ...(isElite ? [{ label: "Bet Tracker", href: "/bets", description: "Skill Score · CLV · ROI", icon: <BarChart3 className="h-4 w-4" /> }] : [{ label: "Bet Tracker", href: "/bets", description: "Skill Score · Elite", icon: <BarChart3 className="h-4 w-4" />, badge: "Elite" }]),
        { label: "Settings", href: "/settings", description: "Preferences + billing", icon: <Sparkles className="h-4 w-4" /> },
      ],
    });
    toolsItems.push({
      heading: "Discover",
      items: [
        { label: "Compare sportsbooks", href: "/compare", description: "Kalshi vs each book", icon: <GitCompare className="h-4 w-4" /> },
        { label: "Learn", href: "/learn", description: "Kalshi odds explainers", icon: <BookOpen className="h-4 w-4" /> },
      ],
    });
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="container mx-auto flex h-14 max-w-[1800px] items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-1 min-w-0">
          <Link href={isAnonymous ? "/" : "/dashboard"} className="flex items-center gap-2 font-semibold mr-3 shrink-0">
            <LineChart className="h-5 w-5 text-emerald-500" aria-hidden="true" />
            <span className="text-lg tracking-tight">SportsBook<span className="text-emerald-500">ISH</span></span>
          </Link>
          <nav className="flex items-center gap-0.5" aria-label="Primary">
            <NavDropdown label="Sports" sections={sportsSections} width="wide" />
            <NavDropdown label="Tools" sections={toolsItems} width="narrow" />
            <Link href="/pricing" className={buttonVariants({ variant: "ghost", size: "sm" })}>Pricing</Link>
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
              <UserMenu email={userEmail || ""} tier={tier} isAdmin={isAdmin} />
            </>
          )}
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}
