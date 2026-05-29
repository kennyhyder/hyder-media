import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAmerican, bookLabel } from "@/lib/format";
import { eventUrl, slugify } from "@/lib/slug";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { trackIfUser } from "@/lib/track-event";
import { getCurrentTier } from "@/lib/tier-guard";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const DATA_HOST = process.env.NEXT_PUBLIC_DATA_HOST || "https://hyder.me";

const TITLE = "Live Sports Middles — Spread & Total Middle Bets | SportsBookISH";
const DESC = "Every sportsbook spread and total middle in play right now. Two books, two lines, one bet on each — if the final score lands in the middle zone, both bets win. Updated continuously.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE_URL}/sports/middles` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE_URL}/sports/middles`, siteName: "SportsBookISH", type: "website" },
};

interface MiddleRow {
  kind: "total" | "spread";
  event_id: string;
  event: {
    id: string;
    league: string;
    title: string;
    slug: string | null;
    season_year: number | null;
    start_time: string | null;
  };
  width: number;
  // total fields
  over?: { point: number; book: string; american: number };
  under?: { point: number; book: string; american: number };
  // spread fields
  leg_a?: { point: number; book: string; american: number; label: string };
  leg_b?: { point: number; book: string; american: number; label: string };
}

const HUB_FAQ = [
  {
    question: "What is a middle bet?",
    answer: "A middle is when two sportsbooks offer non-overlapping lines on the same market. You bet OVER the lower number at one book and UNDER the higher number at another. If the final result lands in the gap between the two numbers, both bets win. If it lands outside, exactly one bet wins and you lose only the vig on the loser.",
  },
  {
    question: "Are middles +EV?",
    answer: "Yes. Even with -110 vig on both legs, a 1-point middle on NBA totals (where final scores fall on every integer roughly equally near the line) pays out roughly 4-7% of the time, more than enough to cover the ~5% loss when both miss. Wider middles are higher EV.",
  },
  {
    question: "How wide should a middle be to bet?",
    answer: "At least 0.5 points to be a real middle (not just price disagreement). 1+ point middles on NBA/MLB totals and 2+ point middles on NFL spreads are the historical sweet spot.",
  },
  {
    question: "Why don't books close middles instantly?",
    answer: "Books move lines on the action they're seeing, not what other books are doing in real time. Slow movers (Caesars, Fanatics, regional books) frequently sit 0.5-1 point off DraftKings/FanDuel for 15-90 minutes pre-game. That's the middle window.",
  },
];

export default async function MiddlesPage() {
  const { userId } = await getCurrentTier();
  void trackIfUser(userId, "positive_ev_view", { props: { surface: "middles" } });
  const renderTime = new Date().toISOString();

  let middles: MiddleRow[] = [];
  let totalsCount = 0;
  let spreadsCount = 0;
  try {
    const r = await fetch(`${DATA_HOST}/api/sports/middles?since_min=120&min_width=0.5`, { next: { revalidate: 30 } });
    if (r.ok) {
      const data = await r.json();
      middles = data.middles || [];
      totalsCount = data.totals_count || 0;
      spreadsCount = data.spreads_count || 0;
    }
  } catch { /* graceful empty */ }

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sports", url: `${SITE_URL}/sports` },
        { name: "Middles", url: `${SITE_URL}/sports/middles` },
      ])} />
      <JsonLd data={faqLd(HUB_FAQ)} />
      <JsonLd data={datasetFreshnessLd({
        name: "Live sports middle bets",
        description: DESC,
        pageUrl: `${SITE_URL}/sports/middles`,
        dateModified: renderTime,
      })} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4 gap-2">
          <Link href="/sports" className="text-sm text-muted-foreground hover:text-foreground shrink-0">← Sports</Link>
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
            Middles · {middles.length} live
          </div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">Live Sports Middles</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Spread and total middles where two regulated US sportsbooks offer non-overlapping lines.
            Bet both sides; if the final score lands in the middle, both win. Widths ≥0.5 points only.
          </p>
        </section>

        {middles.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p>No live middles right now.</p>
              <p className="text-xs mt-2">Middles are most common 30-90 min pre-game when slow-moving books lag DraftKings/FanDuel on line moves.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Total middles</div><div className="text-2xl font-bold tabular-nums">{totalsCount}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Spread middles</div><div className="text-2xl font-bold tabular-nums">{spreadsCount}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Widest</div><div className="text-2xl font-bold tabular-nums text-emerald-400">{middles[0]?.width.toFixed(1)}</div></CardContent></Card>
            </section>

            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  Top {middles.length} middles, widest first. Both legs must be at regulated US books.
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Width</TableHead>
                      <TableHead>Leg 1</TableHead>
                      <TableHead>Leg 2</TableHead>
                      <TableHead>Start</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/40">
                    {middles.map((m, idx) => {
                      const ev = m.event;
                      const year = ev?.season_year || (ev?.start_time ? new Date(ev.start_time).getUTCFullYear() : new Date().getUTCFullYear());
                      const slug = ev?.slug || slugify(ev?.title || "");
                      const href = slug ? eventUrl(ev?.league || "", year, slug) : `/sports/${ev?.league}/event/${m.event_id}`;
                      const leg1 = m.kind === "total"
                        ? { label: `OVER ${m.over!.point}`, book: m.over!.book, american: m.over!.american }
                        : { label: `${m.leg_a!.label} ${m.leg_a!.point > 0 ? "+" : ""}${m.leg_a!.point}`, book: m.leg_a!.book, american: m.leg_a!.american };
                      const leg2 = m.kind === "total"
                        ? { label: `UNDER ${m.under!.point}`, book: m.under!.book, american: m.under!.american }
                        : { label: `${m.leg_b!.label} ${m.leg_b!.point > 0 ? "+" : ""}${m.leg_b!.point}`, book: m.leg_b!.book, american: m.leg_b!.american };
                      return (
                        <TableRow key={`${m.event_id}|${m.kind}|${idx}`}>
                          <TableCell className="font-medium">
                            <Link href={href} className="hover:text-emerald-400 hover:underline">{ev?.title || "—"}</Link>
                            <div className="text-[10px] text-muted-foreground/80 uppercase">{ev?.league}</div>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{m.kind === "total" ? "Total" : "Spread"}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-400 font-bold">{m.width.toFixed(1)}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            <span className="font-medium">{leg1.label}</span>{" "}
                            <span className="text-muted-foreground/80">{fmtAmerican(leg1.american)}</span>
                            <div className="text-[10px] text-muted-foreground">{bookLabel(leg1.book)}</div>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            <span className="font-medium">{leg2.label}</span>{" "}
                            <span className="text-muted-foreground/80">{fmtAmerican(leg2.american)}</span>
                            <div className="text-[10px] text-muted-foreground">{bookLabel(leg2.book)}</div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {ev?.start_time ? new Date(ev.start_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}

        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {HUB_FAQ.map((f, i) => (
                <div key={i} className="p-4">
                  <div className="font-semibold mb-1">{f.question}</div>
                  <div className="text-sm text-muted-foreground">{f.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
