import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Trophy } from "lucide-react";
import { fetchLeagues } from "@/lib/sports-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function SportsHub() {
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect("/login?next=/sports");
  const leagues = await fetchLeagues();
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">All Sports</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold mb-1">Sports</h1>
        <p className="text-sm text-muted-foreground mb-4">Pick a league. Edge data is ingested from Kalshi every 5 min.</p>
        <Link href="/sports/movers" className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 mb-6">
          📈 View top movers across all sports →
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link href="/golf" className="block">
            <Card className="hover:border-emerald-500/40 transition-colors">
              <CardContent className="p-5 flex items-center gap-4">
                <span className="text-4xl">⛳</span>
                <div className="flex-1">
                  <div className="font-semibold">Golf</div>
                  <div className="text-xs text-muted-foreground">PGA Tour · DataGolf book overlay</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          {leagues.map((l) => (
            <Link key={l.key} href={`/sports/${l.key}`} className="block">
              <Card className="hover:border-emerald-500/40 transition-colors">
                <CardContent className="p-5 flex items-center gap-4">
                  <span className="text-4xl">{l.icon}</span>
                  <div className="flex-1">
                    <div className="font-semibold">{l.display_name}</div>
                    <div className="text-xs text-muted-foreground">{l.sport_category[0].toUpperCase()}{l.sport_category.slice(1)} · Kalshi only</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {tier === "free" && (
          <div className="mt-8 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <strong>Free tier</strong>: see headline winner odds only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro</Link> for all bet types across every sport.
          </div>
        )}
      </main>
    </div>
  );
}
