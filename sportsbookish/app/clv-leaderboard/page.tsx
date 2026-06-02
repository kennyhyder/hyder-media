import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createServiceClient } from "@/lib/supabase/server";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { fmtPctSigned } from "@/lib/format";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const TITLE = "CLV Leaderboard — Public Closing Line Value Rankings | SportsBookISH";
const DESC = "Anonymous public leaderboard of opt-in SportsBookISH users by Closing Line Value (CLV). The single metric that predicts long-run profitability in sports betting, independent of variance.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/clv-leaderboard` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/clv-leaderboard`, siteName: "SportsBookISH", type: "website" },
};

interface LeaderRow {
  display_name: string;
  bets_30d: number;
  bets_settled: number;
  avg_clv: number;
  win_rate: number | null;
  total_units: number;
  sport_focus: string | null;
}

const FAQ = [
  {
    question: "What is CLV?",
    answer: "Closing Line Value — the gap between the line you bet at and where the line ended up at game close. If you bet a team at +150 and the line closes at +120, you got +CLV: the market moved toward your side, meaning you bet at a price the market eventually agreed was too generous. Average CLV over many bets is the strongest single predictor of long-run profit, independent of W/L variance.",
  },
  {
    question: "How do I get on the leaderboard?",
    answer: "Track at least 10 bets in the SportsBookISH bet tracker (Elite tier required) and opt-in via /settings. You choose a display name; we never publish your real identity, email, or bet amounts. Only your aggregate stats appear.",
  },
  {
    question: "How is CLV computed?",
    answer: "When you log a bet, we snapshot the book consensus median at game start as the closing line. CLV = closing_implied_prob − line_implied_prob_at_bet. Positive means the line moved toward your side after you placed it. The leaderboard ranks by 30-day average CLV across settled bets.",
  },
  {
    question: "Can I opt out?",
    answer: "Yes, anytime. Flip the toggle in /settings and your row is removed within minutes. Your tracker data is unaffected; only the public leaderboard presence changes.",
  },
];

async function fetchLeaderboard(): Promise<LeaderRow[]> {
  const supabase = createServiceClient();
  // Pull opt-in users
  const { data: optInUsers } = await supabase
    .from("sb_user_preferences")
    .select("user_id, leaderboard_display_name")
    .eq("clv_leaderboard_opt_in", true);
  if (!optInUsers?.length) return [];

  const userIds = optInUsers.map((u) => u.user_id as string);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  // Pull all bets in last 30d for these users
  const { data: bets } = await supabase
    .from("sb_bets")
    .select("user_id, status, line_implied_prob, closing_implied_prob, clv, profit_units, league")
    .in("user_id", userIds)
    .gte("placed_at", since);
  if (!bets?.length) return [];

  // Aggregate per user
  const byUser = new Map<string, LeaderRow>();
  const displayByUser = new Map(optInUsers.map((u) => [u.user_id as string, (u.leaderboard_display_name as string) || `Sharp #${(u.user_id as string).slice(0, 6)}`]));
  for (const b of bets) {
    const uid = b.user_id as string;
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        display_name: displayByUser.get(uid) || `Sharp #${uid.slice(0, 6)}`,
        bets_30d: 0,
        bets_settled: 0,
        avg_clv: 0,
        win_rate: null,
        total_units: 0,
        sport_focus: null,
      });
    }
    const r = byUser.get(uid)!;
    r.bets_30d++;
    if (b.status === "won" || b.status === "lost" || b.status === "push") r.bets_settled++;
    if (typeof b.profit_units === "number") r.total_units += b.profit_units;
  }

  // Average CLV per user (only over bets where CLV is captured)
  for (const [uid, row] of byUser) {
    const userBets = bets.filter((b) => b.user_id === uid);
    const clvVals = userBets.map((b) => b.clv as number).filter((v) => typeof v === "number");
    row.avg_clv = clvVals.length ? clvVals.reduce((s, v) => s + v, 0) / clvVals.length : 0;
    const wins = userBets.filter((b) => b.status === "won").length;
    const decisive = userBets.filter((b) => b.status === "won" || b.status === "lost").length;
    row.win_rate = decisive >= 5 ? wins / decisive : null;
    // Sport focus = most common league
    const leagueCounts = new Map<string, number>();
    for (const b of userBets) if (b.league) leagueCounts.set(b.league as string, (leagueCounts.get(b.league as string) || 0) + 1);
    const top = Array.from(leagueCounts.entries()).sort((a, b) => b[1] - a[1])[0];
    row.sport_focus = top ? top[0] : null;
  }

  // Require minimum bet count for ranking
  return Array.from(byUser.values())
    .filter((r) => r.bets_30d >= 10)
    .sort((a, b) => b.avg_clv - a.avg_clv)
    .slice(0, 100);
}

export default async function CLVLeaderboardPage() {
  const renderTime = new Date().toISOString();
  const leaders = await fetchLeaderboard();

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "CLV Leaderboard", url: `${SITE_URL}/clv-leaderboard` },
      ])} />
      <JsonLd data={faqLd(FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: "Public CLV Leaderboard",
        description: DESC,
        pageUrl: `${SITE_URL}/clv-leaderboard`,
        dateModified: renderTime,
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">CLV Leaderboard</div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-10 space-y-8">
        <section>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">Public CLV Leaderboard</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">
            Opt-in public ranking by Closing Line Value — the single metric that predicts who&apos;s
            actually beating the market vs running variance. Updated continuously from the
            SportsBookISH bet tracker. <Link href="/settings" className="text-emerald-400 hover:underline">Join the board →</Link>
          </p>
        </section>

        {leaders.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-lg font-medium mb-2 text-foreground">No leaders yet.</p>
              <p className="text-sm">Be the first — log 10+ bets in the tracker and opt in from <Link href="/settings" className="text-emerald-400 hover:underline">/settings</Link>.</p>
              <p className="text-xs mt-3">Bet Tracker is an Elite feature ($39/mo). <Link href="/pricing" className="text-emerald-400 hover:underline">See plans →</Link></p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">
                30-day CLV ranking · {leaders.length} qualifying participants · min 10 bets in last 30 days
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>Bettor</TableHead>
                    <TableHead className="text-right">Avg CLV</TableHead>
                    <TableHead className="text-right">Bets (30d)</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead>Focus</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/40">
                  {leaders.map((r, i) => (
                    <TableRow key={r.display_name + i}>
                      <TableCell className="font-bold text-muted-foreground">#{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.display_name}</TableCell>
                      <TableCell className={`text-right tabular-nums font-bold ${r.avg_clv > 0 ? "text-emerald-400" : r.avg_clv < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                        {fmtPctSigned(r.avg_clv, 2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.bets_30d} ({r.bets_settled} settled)</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.win_rate != null ? `${(r.win_rate * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${r.total_units > 0 ? "text-emerald-300" : r.total_units < 0 ? "text-rose-300" : "text-muted-foreground"}`}>
                        {r.total_units > 0 ? "+" : ""}{r.total_units.toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {r.sport_focus ? <Badge variant="outline" className="text-xs">{r.sport_focus.toUpperCase()}</Badge> : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {FAQ.map((f, i) => (
                <div key={i} className="p-4">
                  <div className="font-semibold mb-1">{f.question}</div>
                  <div className="text-sm text-muted-foreground">{f.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
          <h2 className="text-lg font-semibold mb-2">Want on the board?</h2>
          <p className="text-sm text-muted-foreground mb-4">Track 10+ bets in the tracker, opt in from your settings, and your row appears.</p>
          <div className="flex justify-center gap-2 flex-wrap">
            <Link href="/pricing" className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-600 text-emerald-950 text-sm font-medium">See Elite plan →</Link>
            <Link href="/settings" className="px-4 py-2 rounded-md border border-border/60 hover:bg-muted text-sm">Opt in (existing Elite) →</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
