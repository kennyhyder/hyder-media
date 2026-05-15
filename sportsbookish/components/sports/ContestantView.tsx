import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchTeamBySlug, fetchLeagues } from "@/lib/sports-data";
import { eventUrl, teamUrl, playerUrl } from "@/lib/slug";
import { fmtPct, fmtPctSigned } from "@/lib/format";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

const EVENT_TYPE_LABEL: Record<string, string> = {
  game: "Game",
  series: "Playoff series",
  championship: "Championship",
  conference: "Conference",
  division: "Division",
  playoffs: "Make / miss playoffs",
  record_best: "Best record",
  record_worst: "Worst record",
  win_total: "Win totals",
  mvp: "MVP",
  award: "Award",
  trade: "Trades",
};

// Renders a contestant hub (team OR player) with the same data shape, just
// different page copy + JSON-LD type. Used by both /teams/[slug] and
// /players/[slug] routes.
export default async function ContestantView({
  league,
  slug,
  expectedKind,
  canonicalPath,
}: {
  league: string;
  slug: string;
  expectedKind: "team" | "player";  // controls copy + schema
  canonicalPath: string;
}) {
  const [t, leagues] = await Promise.all([fetchTeamBySlug(league, slug), fetchLeagues()]);
  if (!t) notFound();
  const leagueMeta = leagues.find((l) => l.key === league);
  if (!leagueMeta) notFound();

  const isPlayer = expectedKind === "player";
  const entityLabel = isPlayer ? "player" : "team";

  // Group markets by event_type
  const byType = new Map<string, typeof t.markets>();
  for (const m of t.markets) {
    const k = m.event.event_type;
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(m);
  }
  const typeOrder = ["game", "series", "championship", "conference", "division", "playoffs", "mvp", "award", "record_best", "record_worst", "win_total", "trade"];

  // JSON-LD — Person for individual contestants, SportsTeam for teams
  const ldData: object[] = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Sports", url: "/sports" },
      { name: leagueMeta.display_name, url: `/sports/${league}` },
      { name: t.team.name, url: canonicalPath },
    ]),
    isPlayer
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: t.team.name,
          url: `${SITE_URL}${canonicalPath}`,
          jobTitle: `Professional ${leagueMeta.sport_category || "Athlete"}`,
          affiliation: { "@type": "SportsTeam", name: leagueMeta.display_name },
        }
      : {
          "@context": "https://schema.org",
          "@type": "SportsTeam",
          name: t.team.name,
          url: `${SITE_URL}${canonicalPath}`,
          sport: leagueMeta.sport_category || "Sports",
          memberOf: { "@type": "SportsOrganization", name: leagueMeta.display_name },
        },
  ];

  // FAQ
  const bestEdge = t.markets.reduce<{ event_title: string; edge: number; label: string } | null>((acc, m) => {
    if (!m.kalshi?.implied_prob || !m.books?.median) return acc;
    const edge = m.books.median - m.kalshi.implied_prob;
    if (!acc || Math.abs(edge) > Math.abs(acc.edge)) return { event_title: m.event.title, edge, label: m.contestant_label };
    return acc;
  }, null);

  const faqItems = isPlayer
    ? [
        {
          question: `What ${t.team.name} betting markets are tradeable on Kalshi right now?`,
          answer: `Kalshi currently lists ${t.counts.total} markets featuring ${t.team.name}, including MVP, award, season win total, playoff make/miss, and (where applicable) team game markets. SportsBookISH compares each Kalshi price against the consensus across DraftKings, FanDuel, BetMGM and 8+ sportsbooks.`,
        },
        ...(bestEdge ? [{
          question: `Where's the best ${t.team.name} betting edge right now?`,
          answer: `${bestEdge.label} on ${bestEdge.event_title} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the sportsbook consensus.`,
        }] : []),
        {
          question: `Are ${t.team.name} MVP odds available on Kalshi?`,
          answer: `Yes — if ${t.team.name} is in the running for league MVP, Kalshi typically lists them in the season MVP market. SportsBookISH tracks every Kalshi futures market that names ${t.team.name} as a contestant.`,
        },
        {
          question: `How often do ${t.team.name} odds update?`,
          answer: `Kalshi prices refresh every 5 minutes; sportsbook lines refresh every 15-30 minutes. References older than 30 minutes are filtered out. Elite subscribers can force-refresh any individual event.`,
        },
      ]
    : [
        {
          question: `What ${t.team.name} markets are tradeable on Kalshi right now?`,
          answer: `Kalshi currently lists ${t.counts.games} ${t.counts.games === 1 ? "game" : "games"} and ${t.counts.futures} futures markets featuring ${t.team.name}. SportsBookISH compares each against the DraftKings/FanDuel/BetMGM consensus so you can find the cheapest side.`,
        },
        ...(bestEdge ? [{
          question: `Where's the best ${t.team.name} betting edge right now?`,
          answer: `${bestEdge.label} on ${bestEdge.event_title} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the sportsbook consensus.`,
        }] : []),
        {
          question: `How often do ${t.team.name} odds update?`,
          answer: `Kalshi prices refresh every 5 minutes; sportsbook lines refresh every 15-30 minutes. References older than 30 minutes are filtered out automatically. Elite subscribers can force-refresh any individual event.`,
        },
        {
          question: `Are ${t.team.name} futures (championship, division, MVP) available?`,
          answer: `Yes — SportsBookISH tracks every Kalshi futures market that lists ${t.team.name} as a contestant, including championship, conference, division winner, win total, and award markets where applicable.`,
        },
      ];
  ldData.push(faqLd(faqItems));

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4">
          <Link href={`/sports/${league}`} className="text-sm text-muted-foreground hover:text-foreground/80">← {leagueMeta.display_name}</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span className="text-base">{leagueMeta.icon}</span>
            <span>{t.team.name}</span>
          </div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{t.team.name} odds</h1>
          <p className="text-sm text-muted-foreground">
            Live Kalshi event-contract pricing vs sportsbook consensus for every {t.team.name} market.
            <span className="ml-2 text-foreground/80">
              {isPlayer ? `${t.counts.total} ${t.counts.total === 1 ? "market" : "markets"}` : `${t.counts.games} games · ${t.counts.futures} futures`}
            </span>
          </p>
        </div>

        {t.markets.length === 0 && (
          <div className="text-center text-muted-foreground py-16">
            No open markets for {t.team.name} right now. Check back during the season.
          </div>
        )}

        {typeOrder.map((type) => {
          const list = byType.get(type);
          if (!list?.length) return null;
          return (
            <section key={type} className="mb-8">
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">{EVENT_TYPE_LABEL[type] || type} ({list.length})</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((m) => {
                  const e = m.event;
                  const href = e.slug && e.season_year ? eventUrl(league, e.season_year, e.slug) : `/sports/${league}/event/${e.id}`;
                  const edge = (m.kalshi?.implied_prob != null && m.books?.median != null) ? m.books.median - m.kalshi.implied_prob : null;
                  return (
                    <Link key={m.market_id} href={href} className="block">
                      <Card className="hover:border-emerald-500/40 transition-colors h-full">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold leading-tight">{e.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="pb-4 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Kalshi</span>
                            <span className="tabular-nums text-amber-500 font-semibold">{fmtPct(m.kalshi?.implied_prob)}</span>
                          </div>
                          {m.books?.median != null && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Books median ({m.books.count})</span>
                              <span className="tabular-nums">{fmtPct(m.books.median)}</span>
                            </div>
                          )}
                          {edge != null && (
                            <div className="flex items-center justify-between pt-1 border-t border-border/40">
                              <span className="text-muted-foreground">Edge</span>
                              <span className={`tabular-nums font-semibold ${edge > 0 ? "text-emerald-500" : edge < 0 ? "text-rose-500" : ""}`}>{fmtPctSigned(edge)}</span>
                            </div>
                          )}
                          {e.start_time && (
                            <div className="text-[10px] text-muted-foreground/70 pt-1">
                              {new Date(e.start_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}

        <FaqSection items={faqItems} heading={`${t.team.name} betting — FAQ`} />

        <div className="mt-8 rounded-md border border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2 border-border/60">{leagueMeta.display_name}</Badge>
          Every {t.team.name} market on Kalshi compared against {(t.markets.find((m) => m.books?.count)?.books?.count) || "13+"} US sportsbooks. Updated every 5 minutes.
        </div>
      </main>
    </div>
  );
}

export { teamUrl, playerUrl };
