import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTier } from "@/lib/tier-guard";
import { computeSkillScore, TIER_INFO, type Bet } from "@/lib/bet-score";
import BetsPanel from "@/components/bets/BetsPanel";
import SkillScoreCard from "@/components/bets/SkillScoreCard";

export const dynamic = "force-dynamic";

export default async function BetsPage() {
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect("/login?next=/bets");

  if (tier !== "elite") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-500" aria-hidden="true" />
            </div>
            <CardTitle>Bet Tracker is an Elite feature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Log every bet you place — at Kalshi or any sportsbook — and get a real-time <strong className="text-foreground">Skill Score</strong> (0–1000) that grades you on CLV, ROI, calibration, difficulty, and risk-adjusted return.
            </p>
            <p className="text-xs">
              Not just W-L. The algorithm weighs harder bets more, rewards beating the closing line, and surfaces whether your edges are genuine skill or short-term variance.
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>See plans</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: betsData } = await supabase
    .from("sb_bets")
    .select("*")
    .eq("user_id", userId)
    .order("placed_at", { ascending: false });
  const bets = (betsData || []) as Bet[];
  const score = computeSkillScore(bets);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            Bet Tracker
          </div>
          <Badge className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/20">Elite</Badge>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
        <SkillScoreCard score={score} />
        <BetsPanel initialBets={bets} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">How the Skill Score works</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>Score = 300 × ROI + 300 × CLV + 200 × Calibration + 100 × Difficulty + 100 × Sharpe (all normalized).</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong className="text-foreground">CLV</strong> (Closing Line Value): did the line move toward your side after you bet? Best single skill predictor.</li>
              <li><strong className="text-foreground">ROI</strong>: profit ÷ total stake.</li>
              <li><strong className="text-foreground">Calibration (Brier)</strong>: optional — if you log your stated probability, scored against actual outcomes.</li>
              <li><strong className="text-foreground">Difficulty</strong>: avg implied probability of bets you WON — lower = harder bets that hit.</li>
              <li><strong className="text-foreground">Sharpe</strong>: mean per-bet return ÷ stddev of returns. Rewards consistency.</li>
            </ul>
            <p>Need at least 5 settled bets before the composite score appears. Tiers: 0-349 novice, 350-549 casual, 550-749 sharp, 750+ pro.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
