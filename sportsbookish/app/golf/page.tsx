import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trophy } from "lucide-react";
import { fetchTournaments } from "@/lib/golf-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";
import UpsellBanner from "@/components/UpsellBanner";
import { slugify, tournamentUrl } from "@/lib/slug";

export const dynamic = "force-dynamic";

export default async function GolfHome() {
  const { tier, userId } = await getCurrentTier();
  const isAnonymous = !userId;
  const tournaments = await fetchTournaments();
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      {isAnonymous && <UpsellBanner variant="anonymous" next="/golf" />}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href={isAnonymous ? "/" : "/dashboard"} className="text-sm text-muted-foreground hover:text-foreground">
            ← {isAnonymous ? "Home" : "Dashboard"}
          </Link>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-500" />
            <span className="font-semibold">Golf — PGA Tour</span>
          </div>
          {isAnonymous ? (
            <Link href="/signup?next=/golf" className="text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 font-semibold">Sign up free</Link>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
          )}
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center gap-2 mb-4 text-xs">
          <Link href="/golf/players" className="rounded border border-border bg-card/50 px-3 py-1.5 hover:border-emerald-500/40 hover:bg-card transition-colors">
            All PGA Tour golfers →
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Active tournaments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live data ingested from Kalshi every 5 min + DataGolf every 10 min.
            {!isAnonymous && tier === "free" && (
              <> You&apos;re on the <strong>First Line</strong> plan — winner markets only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro</Link> for top-5/10/20, props, matchups, and your home-book preference.</>
            )}
            {isAnonymous && (
              <> Free signup: save favorites + daily edge digest. <Link href="/pricing" className="text-emerald-400 hover:underline">Pro $19</Link> unlocks every market, every book.</>
            )}
          </p>
        </div>

        {tournaments.length === 0 && (
          <div className="text-muted-foreground">No active tournaments. Check back during a tournament week.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tournaments.map((t) => {
            // Use the DB-stored slug + season_year (canonical). Fall back to a
            // computed slug from t.name only if backfill hasn't run yet, and
            // the legacy ?id= URL if both are missing.
            const year = t.season_year || (t.start_date ? new Date(t.start_date).getUTCFullYear() : new Date().getUTCFullYear());
            const slug = t.slug || slugify(t.name);
            const href = slug ? tournamentUrl(year, slug) : `/golf/tournament?id=${t.id}`;
            return (
            <Link key={t.id} href={href} className="block">
              <Card className="hover:border-emerald-500/40 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-tight">{t.name}</CardTitle>
                    {t.is_major && <Badge className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/20">Major</Badge>}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
                    {t.start_date && <div>{t.start_date}{t.end_date && t.end_date !== t.start_date ? ` → ${t.end_date}` : ""}</div>}
                    <div>Tour: {t.tour.toUpperCase()}</div>
                    <div>Status: {t.status}</div>
                  </div>
                  <div className="flex items-center text-sm text-emerald-400 group-hover:text-emerald-300">
                    Open dashboard <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
