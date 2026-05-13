import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trophy } from "lucide-react";
import { fetchTournaments } from "@/lib/golf-data";
import { getCurrentTier } from "@/lib/tier-guard";
import { TIER_BY_KEY } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function GolfHome() {
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect("/login?next=/golf");

  const tournaments = await fetchTournaments();
  const tierInfo = TIER_BY_KEY[tier];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-500" />
            <span className="font-semibold">Golf — PGA Tour</span>
          </div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{tierInfo.name}</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Active tournaments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live data ingested from Kalshi every 5 min + DataGolf every 10 min.{" "}
            {tier === "free" && (
              <>You&apos;re on the <strong>First Line</strong> plan — winner markets only. <Link href="/pricing" className="text-emerald-400 hover:underline">Upgrade to Pro</Link> for top-5/10/20, props, matchups, and your home-book preference.</>
            )}
          </p>
        </div>

        {tournaments.length === 0 && (
          <div className="text-muted-foreground">No active tournaments. Check back during a tournament week.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/golf/tournament?id=${t.id}`} className="block">
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
          ))}
        </div>
      </main>
    </div>
  );
}
