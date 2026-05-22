import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchTeamBySlug, fetchLeagues } from "@/lib/sports-data";
import type { TeamMarket } from "@/lib/sports-data";
import { eventUrl } from "@/lib/slug";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel } from "@/lib/format";
import FaqSection from "@/components/FaqSection";
import { NoBooksDataNote } from "@/components/sports/NoBooksDataNote";
import { getCurrentTier } from "@/lib/tier-guard";
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

// Render relative time ("3 min ago") for freshness signal — helps users +
// helps Google see pages as fresh content.
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  return `${Math.floor(ms / 86_400_000)} days ago`;
}

export default async function ContestantView({
  league,
  slug,
  expectedKind,
  canonicalPath,
}: {
  league: string;
  slug: string;
  expectedKind: "team" | "player";
  canonicalPath: string;
}) {
  const [t, leagues, { tier }] = await Promise.all([
    fetchTeamBySlug(league, slug),
    fetchLeagues(),
    getCurrentTier(),
  ]);
  if (!t) notFound();
  const leagueMeta = leagues.find((l) => l.key === league);
  if (!leagueMeta) notFound();

  const isPlayer = expectedKind === "player";

  // Group markets by event_type
  const byType = new Map<string, TeamMarket[]>();
  for (const m of t.markets) {
    const k = m.event.event_type;
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(m);
  }
  const typeOrder = ["game", "series", "championship", "conference", "division", "playoffs", "mvp", "award", "record_best", "record_worst", "win_total", "trade"];

  // Largest edge across all markets — used for FAQ best-edge answer
  const bestEdge = t.markets.reduce<{ event_title: string; edge: number; label: string } | null>((acc, m) => {
    if (!m.kalshi?.implied_prob || !m.books?.median) return acc;
    const edge = m.books.median - m.kalshi.implied_prob;
    if (!acc || Math.abs(edge) > Math.abs(acc.edge)) return { event_title: m.event.title, edge, label: m.contestant_label };
    return acc;
  }, null);

  // Coverage summary — surfaces data depth on the page (real text helps SEO
  // vs empty cells)
  const coverage = {
    kalshi: t.markets.filter((m) => m.kalshi?.implied_prob != null).length,
    books: t.markets.filter((m) => m.books != null).length,
    polymarket: t.markets.filter((m) => m.polymarket != null).length,
  };

  // JSON-LD
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
  // dateModified anchor — Google ranks pages with explicit fresh dateModified higher
  if (t.freshest_at) {
    ldData.push({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${t.team.name} live odds dataset`,
      description: `Real-time Kalshi event-contract pricing, US sportsbook consensus, and Polymarket overlay for every active ${t.team.name} betting market. Refreshed every 5 minutes.`,
      url: `${SITE_URL}${canonicalPath}`,
      creator: { "@type": "Organization", name: "SportsBookISH" },
      dateModified: t.freshest_at,
      isAccessibleForFree: true,
      variableMeasured: ["Kalshi implied probability", "Sportsbook consensus (no-vig)", "Polymarket implied probability", "Per-book American odds", "Best book per side"],
    });
  }

  const faqItems = isPlayer
    ? [
        {
          question: `What ${t.team.name} betting markets are tradeable on Kalshi right now?`,
          answer: `Kalshi currently lists ${t.counts.total} markets featuring ${t.team.name}${coverage.kalshi < t.counts.total ? ` (of which ${coverage.kalshi} have active Kalshi prices)` : ""}, including MVP, award, season win total, playoff make/miss, and (where applicable) team game markets. SportsBookISH compares each Kalshi price against the consensus across DraftKings, FanDuel, BetMGM and 8+ sportsbooks, plus a Polymarket overlay where the same market exists on Polymarket.`,
        },
        ...(bestEdge ? [{
          question: `Where's the best ${t.team.name} betting edge right now?`,
          answer: `${bestEdge.label} on ${bestEdge.event_title} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the sportsbook consensus.`,
        }] : []),
        {
          question: `Are ${t.team.name} MVP odds available on Kalshi?`,
          answer: `Yes — if ${t.team.name} is in the running for league MVP, Kalshi typically lists them in the season MVP market. SportsBookISH tracks every Kalshi futures market that names ${t.team.name} as a contestant. ${coverage.books > 0 ? `${coverage.books} of the ${t.counts.total} ${t.team.name} markets also have sportsbook pricing available.` : "Sportsbooks rarely publish per-player pricing for award/draft markets — Kalshi is the canonical signal here."}`,
        },
        {
          question: `How often do ${t.team.name} odds update?`,
          answer: `Kalshi prices refresh every 5 minutes; sportsbook lines refresh every 15-30 minutes; Polymarket every 15 minutes. References older than 30 minutes are filtered out. ${t.freshest_at ? `Latest update on this page: ${relativeTime(t.freshest_at)}.` : ""}`,
        },
      ]
    : [
        {
          question: `What ${t.team.name} markets are tradeable on Kalshi right now?`,
          answer: `Kalshi currently lists ${t.counts.games} ${t.counts.games === 1 ? "game" : "games"} and ${t.counts.futures} futures markets featuring ${t.team.name}. SportsBookISH compares each against the DraftKings/FanDuel/BetMGM consensus so you can find the cheapest side. ${coverage.polymarket > 0 ? `${coverage.polymarket} markets also have Polymarket comparison data.` : ""}`,
        },
        ...(bestEdge ? [{
          question: `Where's the best ${t.team.name} betting edge right now?`,
          answer: `${bestEdge.label} on ${bestEdge.event_title} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the sportsbook consensus.`,
        }] : []),
        {
          question: `How often do ${t.team.name} odds update?`,
          answer: `Kalshi prices refresh every 5 minutes; sportsbook lines refresh every 15-30 minutes; Polymarket every 15 minutes. References older than 30 minutes are filtered out automatically. ${t.freshest_at ? `Latest update on this page: ${relativeTime(t.freshest_at)}.` : ""}`,
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
          <div className="text-xs text-muted-foreground tabular-nums" title={t.freshest_at || undefined}>
            {t.freshest_at ? `Updated ${relativeTime(t.freshest_at)}` : ""}
          </div>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{t.team.name} odds</h1>
          <p className="text-sm text-muted-foreground">
            Live Kalshi event-contract pricing vs sportsbook consensus + Polymarket overlay for every active {t.team.name} market.
          </p>
          {/* Coverage strip — concrete numbers help both SEO + user trust */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className="px-2 py-1 rounded bg-muted/40 border border-border/40">
              <span className="text-muted-foreground">Markets:</span>{" "}
              <strong className="text-foreground">{t.counts.total}</strong>
              {!isPlayer && t.counts.games > 0 && (
                <span className="text-muted-foreground"> ({t.counts.games} games, {t.counts.futures} futures)</span>
              )}
            </span>
            <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
              <span className="text-muted-foreground">Kalshi pricing:</span>{" "}
              <strong className="text-amber-300">{coverage.kalshi}/{t.counts.total}</strong>
            </span>
            {coverage.books > 0 && (
              <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-muted-foreground">Book consensus:</span>{" "}
                <strong className="text-emerald-300">{coverage.books}/{t.counts.total}</strong>
              </span>
            )}
            {coverage.polymarket > 0 && (
              <span className="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30">
                <span className="text-muted-foreground">Polymarket:</span>{" "}
                <strong className="text-blue-300">{coverage.polymarket}/{t.counts.total}</strong>
              </span>
            )}
          </div>
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
            <section key={type} className="mb-10">
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  {EVENT_TYPE_LABEL[type] || type} ({list.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {list.map((m) => <MarketCard key={m.market_id} m={m} league={league} tier={tier} />)}
              </div>
            </section>
          );
        })}

        <FaqSection items={faqItems} heading={`${t.team.name} betting — FAQ`} />

        <div className="mt-8 rounded-md border border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2 border-border/60">{leagueMeta.display_name}</Badge>
          Every {t.team.name} market on Kalshi compared against US sportsbooks + Polymarket. Kalshi refreshes every 5 min; sportsbooks every 15–30 min; Polymarket every 15 min.
          {t.freshest_at && <span className="ml-2">· Page last updated {relativeTime(t.freshest_at)}.</span>}
        </div>
      </main>
    </div>
  );
}

// One card per market — renders a mini-table with Kalshi + book breakdown +
// Polymarket overlay + best book + per-book grid + freshness. When data is
// genuinely unavailable (e.g. books don't publish per-player futures), shows
// an explicit explanation instead of empty cells.
function MarketCard({ m, league, tier }: { m: TeamMarket; league: string; tier: import("@/lib/tiers").TierKey }) {
  const e = m.event;
  const href = e.slug && e.season_year ? eventUrl(league, e.season_year, e.slug) : `/sports/${league}/event/${e.id}`;
  const edge = (m.kalshi?.implied_prob != null && m.books?.median != null)
    ? m.books.median - m.kalshi.implied_prob
    : null;
  const polyEdge = (m.kalshi?.implied_prob != null && m.polymarket?.implied_prob != null)
    ? m.polymarket.implied_prob - m.kalshi.implied_prob
    : null;
  const showBookExplain = m.books == null && m.kalshi != null;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <Link href={href} className="hover:underline">
          <CardTitle className="text-sm font-semibold leading-tight">{e.title}</CardTitle>
        </Link>
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80 mt-1">
          <span>
            {m.contestant_label}
            {e.start_time && <span className="ml-2">· {new Date(e.start_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          </span>
          <span title={m.freshest_at || undefined} className="tabular-nums">
            {m.freshest_at ? relativeTime(m.freshest_at) : "—"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pb-4 text-xs space-y-2">
        {/* Primary prices row */}
        <div className="space-y-1.5">
          <PriceRow
            label="Kalshi"
            value={m.kalshi?.implied_prob}
            sub={m.kalshi?.yes_bid != null && m.kalshi?.yes_ask != null
              ? `${fmtPct(m.kalshi.yes_bid)} / ${fmtPct(m.kalshi.yes_ask)}`
              : null}
            valueClass="text-amber-300"
          />
          {m.books?.median != null ? (
            <PriceRow
              label={`Books median (${m.books.count})`}
              value={m.books.median}
              sub={`range ${fmtPct(m.books.min)}–${fmtPct(m.books.max)}`}
              valueClass="text-emerald-300"
            />
          ) : showBookExplain ? (
            <div className="text-[10px] italic py-1">
              <NoBooksDataNote eventType={e.event_type} tier={tier} />
            </div>
          ) : null}
          {m.polymarket && (
            <PriceRow
              label="Polymarket"
              value={m.polymarket.implied_prob}
              sub={m.polymarket.volume_usd
                ? `vol $${Math.round(m.polymarket.volume_usd).toLocaleString()}`
                : null}
              valueClass="text-blue-300"
            />
          )}
        </div>

        {/* Edges */}
        {(edge != null || polyEdge != null) && (
          <div className="pt-2 border-t border-border/40 space-y-1">
            {edge != null && (
              <PriceRow
                label="Edge (Kalshi vs books)"
                value={edge}
                signed
                valueClass={edge > 0 ? "text-emerald-300" : "text-rose-300"}
              />
            )}
            {polyEdge != null && (
              <PriceRow
                label="Edge (Kalshi vs Polymarket)"
                value={polyEdge}
                signed
                valueClass={polyEdge > 0 ? "text-emerald-300" : "text-rose-300"}
              />
            )}
          </div>
        )}

        {/* Per-book breakdown — collapsible to keep card scanable */}
        {m.books?.per_book && m.books.per_book.length > 0 && (
          <details className="pt-2 border-t border-border/40">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
              Per-book breakdown ({m.books.per_book.length})
            </summary>
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-[11px]">
              <div className="text-muted-foreground font-medium">Book</div>
              <div className="text-muted-foreground font-medium text-right">American</div>
              <div className="text-muted-foreground font-medium text-right">No-vig %</div>
              {m.books.per_book.map((pb) => (
                <PerBookRow key={pb.book} pb={pb} />
              ))}
            </div>
            {m.books.best && (
              <div className="mt-2 text-[11px] text-emerald-300">
                Best price: <strong>{bookLabel(m.books.best.book)}</strong> at <span className="tabular-nums">{fmtAmerican(m.books.best.american)}</span>
              </div>
            )}
          </details>
        )}

        {/* Genuinely no data — last-resort placeholder */}
        {m.data_status === "no_data" && (
          <div className="text-[11px] text-muted-foreground/60 italic">
            Pricing data pending — Kalshi may not have opened this market yet, or our next ingest cycle hasn't fetched it.
            Re-checks every 5 minutes.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriceRow({
  label, value, sub, signed, valueClass,
}: { label: string; value: number | null | undefined; sub?: string | null; signed?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className={`tabular-nums font-semibold ${valueClass || ""}`}>
          {value == null ? "—" : signed ? fmtPctSigned(value) : fmtPct(value)}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
      </div>
    </div>
  );
}

function PerBookRow({ pb }: { pb: { book: string; american: number | null; novig: number | null } }) {
  return (
    <>
      <div>{bookLabel(pb.book)}</div>
      <div className="text-right tabular-nums">{fmtAmerican(pb.american)}</div>
      <div className="text-right tabular-nums text-muted-foreground">{fmtPct(pb.novig)}</div>
    </>
  );
}

export { teamUrl, playerUrl } from "@/lib/slug";
