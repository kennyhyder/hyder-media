import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchGolferBySlug } from "@/lib/golf-data";
import type { GolferDetail } from "@/lib/golf-data";
import { tournamentUrl, golfPlayerUrl } from "@/lib/slug";
import { fmtPct, fmtPctSigned, fmtAmerican, bookLabel, MARKET_LABELS } from "@/lib/format";
import FaqSection from "@/components/FaqSection";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  return `${Math.floor(ms / 86_400_000)} days ago`;
}

type GolferTournament = GolferDetail["tournaments"][number];
type GolfMarket = GolferTournament["markets"][number];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await fetchGolferBySlug(slug);
  if (!p) return { title: "Player not found" };
  const canonical = `${SITE_URL}${golfPlayerUrl(slug)}`;
  const rankPart = p.player.owgr_rank ? ` (OWGR #${p.player.owgr_rank})` : "";
  const title = `${p.player.name}${rankPart} odds — Kalshi vs Polymarket vs sportsbooks`;
  const description = `Live ${p.player.name} odds across every PGA Tour market on Kalshi — win, top 5/10/20, make cut, first-round leader, head-to-head matchups. Compared against DraftKings, FanDuel, BetMGM and 11+ sportsbooks plus the DataGolf model baseline.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "profile", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GolferPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await fetchGolferBySlug(slug);
  if (!p) notFound();

  const allMarkets = p.tournaments.flatMap((t) => t.markets);
  const totalMarkets = allMarkets.length;
  const hasOwgr = p.player.owgr_rank != null;

  const coverage = {
    kalshi: allMarkets.filter((m) => m.kalshi?.implied_prob != null).length,
    dg: allMarkets.filter((m) => m.dg?.dg_prob != null).length,
    books: allMarkets.filter((m) => m.books != null).length,
  };

  // Biggest edge across all markets — prefers Kalshi vs books, falls back to Kalshi vs DG
  const bestEdge = allMarkets.reduce<{ event: string; market: string; edge: number; vs: string } | null>((acc, m) => {
    const k = m.kalshi?.implied_prob;
    const b = m.books?.median;
    const dg = m.dg?.dg_prob;
    let edge: number | null = null;
    let vs = "";
    if (k != null && b != null) { edge = b - k; vs = "books"; }
    else if (k != null && dg != null) { edge = dg - k; vs = "DataGolf model"; }
    if (edge == null) return acc;
    if (!acc || Math.abs(edge) > Math.abs(acc.edge)) {
      const tEntry = p.tournaments.find((t) => t.markets.includes(m));
      return { event: tEntry?.tournament.name || "current tournament", market: MARKET_LABELS[m.market_type] || m.market_type, edge, vs };
    }
    return acc;
  }, null);

  const ldData: object[] = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Golf", url: "/golf" },
      { name: p.player.name, url: golfPlayerUrl(slug) },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: p.player.name,
      url: `${SITE_URL}${golfPlayerUrl(slug)}`,
      jobTitle: "Professional Golfer",
      ...(p.player.country ? { nationality: p.player.country } : {}),
      ...(p.player.owgr_rank ? { description: `OWGR World Ranking #${p.player.owgr_rank}` } : {}),
    },
  ];
  if (p.freshest_at) {
    ldData.push({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${p.player.name} live golf odds dataset`,
      description: `Real-time Kalshi event-contract pricing, US sportsbook consensus, and DataGolf model probabilities for every active ${p.player.name} betting market across PGA Tour.`,
      url: `${SITE_URL}${golfPlayerUrl(slug)}`,
      creator: { "@type": "Organization", name: "SportsBookISH" },
      dateModified: p.freshest_at,
      isAccessibleForFree: true,
      variableMeasured: ["Kalshi implied probability", "DataGolf model probability", "Sportsbook consensus (no-vig)", "Per-book American odds", "OWGR ranking"],
    });
  }

  const faqItems = [
    {
      question: `What ${p.player.name} betting markets are live right now?`,
      answer: `Kalshi currently lists ${totalMarkets} ${p.player.name} markets across ${p.tournaments.length} ${p.tournaments.length === 1 ? "tournament" : "tournaments"} — outright winner, top 5/10/20, make cut, first-round leader, and head-to-head matchups depending on the event. SportsBookISH compares each against the DataGolf model baseline (${coverage.dg}/${totalMarkets} markets) plus 11+ sportsbooks (${coverage.books}/${totalMarkets} markets).`,
    },
    ...(bestEdge ? [{
      question: `Where's the best ${p.player.name} betting edge right now?`,
      answer: `The ${bestEdge.market} market on ${bestEdge.event} currently shows the largest gap — Kalshi is priced ${(bestEdge.edge * 100).toFixed(1)} percentage points ${bestEdge.edge > 0 ? "cheaper than" : "more expensive than"} the ${bestEdge.vs}. Edges shift continuously; refresh for the latest snapshot.`,
    }] : []),
    ...(hasOwgr ? [{
      question: `What is ${p.player.name}'s world golf ranking?`,
      answer: `${p.player.name} is currently ranked #${p.player.owgr_rank} in the Official World Golf Ranking (OWGR). Rankings update weekly; SportsBookISH refreshes this data from DataGolf at every cron tick.`,
    }] : []),
    {
      question: `How does the DataGolf model compare to Kalshi for ${p.player.name}?`,
      answer: `DataGolf publishes a baseline win/top-N probability based on its proprietary strokes-gained model. When Kalshi prices ${p.player.name} cheaper than that baseline (positive edge), the model suggests Kalshi is mispriced low and the contract is a buy. When Kalshi prices higher, the model considers it expensive.`,
    },
    {
      question: `How often do these odds update?`,
      answer: `Kalshi quotes refresh every 5 minutes. DataGolf model + sportsbook lines refresh every 10 minutes. References older than 30 minutes are filtered out. ${p.freshest_at ? `Latest update on this page: ${relativeTime(p.freshest_at)}.` : ""}`,
    },
  ];
  ldData.push(faqLd(faqItems));

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4">
          <Link href="/golf" className="text-sm text-muted-foreground hover:text-foreground/80">← Golf</Link>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <span>⛳</span>
            <span>{p.player.name}</span>
            {p.player.owgr_rank && <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">OWGR #{p.player.owgr_rank}</Badge>}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums" title={p.freshest_at || undefined}>
            {p.freshest_at ? `Updated ${relativeTime(p.freshest_at)}` : ""}
          </div>
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{p.player.name} odds</h1>
          <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap mb-3">
            <span>Live Kalshi prices vs sportsbook consensus + DataGolf model.</span>
            <span className="text-foreground/70">{totalMarkets} markets across {p.tournaments.length} {p.tournaments.length === 1 ? "tournament" : "tournaments"}</span>
            {p.player.country && <Badge variant="outline" className="border-border/60 text-xs">{p.player.country}</Badge>}
          </div>
          {/* Coverage strip */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="px-2 py-1 rounded bg-muted/40 border border-border/40">
              <span className="text-muted-foreground">Markets:</span>{" "}
              <strong className="text-foreground">{totalMarkets}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30">
              <span className="text-muted-foreground">Kalshi pricing:</span>{" "}
              <strong className="text-amber-300">{coverage.kalshi}/{totalMarkets}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-sky-500/10 border border-sky-500/30">
              <span className="text-muted-foreground">DataGolf model:</span>{" "}
              <strong className="text-sky-300">{coverage.dg}/{totalMarkets}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-muted-foreground">Sportsbook lines:</span>{" "}
              <strong className="text-emerald-300">{coverage.books}/{totalMarkets}</strong>
            </span>
          </div>
        </div>

        {p.tournaments.length === 0 && (
          <div className="text-center text-muted-foreground py-16">
            No open markets for {p.player.name} right now. Check back during the next tournament week.
          </div>
        )}

        {p.tournaments.map(({ tournament, markets, freshest_at }) => {
          const tHref = tournament.slug && tournament.season_year
            ? tournamentUrl(tournament.season_year, tournament.slug)
            : `/golf/tournament?id=${tournament.id}`;
          return (
            <section key={tournament.id} className="mb-10">
              <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                <Link href={tHref} className="text-base font-semibold hover:underline">
                  {tournament.name}
                </Link>
                {tournament.is_major && <Badge className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/20 text-[10px]">Major</Badge>}
                {tournament.start_date && <span className="text-xs text-muted-foreground">{tournament.start_date}</span>}
                {freshest_at && <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">Updated {relativeTime(freshest_at)}</span>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {markets.map((m) => <GolfMarketCard key={m.market_id} m={m} />)}
              </div>
            </section>
          );
        })}

        <FaqSection items={faqItems} heading={`${p.player.name} betting — FAQ`} />

        <div className="mt-8 rounded-md border border-border/60 bg-card/30 p-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2 border-border/60">PGA Tour</Badge>
          Every {p.player.name} market on Kalshi compared against US sportsbooks + the DataGolf model. Kalshi refreshes every 5 min; DataGolf + sportsbooks every 10 min.
          {p.freshest_at && <span className="ml-2">· Page last updated {relativeTime(p.freshest_at)}.</span>}
        </div>
      </main>
    </div>
  );
}

function GolfMarketCard({ m }: { m: GolfMarket }) {
  const edge = (m.kalshi?.implied_prob != null && m.books?.median != null)
    ? m.books.median - m.kalshi.implied_prob
    : null;
  const dgEdge = (m.kalshi?.implied_prob != null && m.dg?.dg_prob != null)
    ? m.dg.dg_prob - m.kalshi.implied_prob
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{MARKET_LABELS[m.market_type] || m.market_type}</CardTitle>
          <span title={m.freshest_at || undefined} className="text-[10px] text-muted-foreground tabular-nums">
            {m.freshest_at ? relativeTime(m.freshest_at) : "—"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pb-4 text-xs space-y-2">
        <div className="space-y-1.5">
          <PriceRow
            label="Kalshi"
            value={m.kalshi?.implied_prob}
            sub={m.kalshi?.yes_bid != null && m.kalshi?.yes_ask != null
              ? `${fmtPct(m.kalshi.yes_bid)} / ${fmtPct(m.kalshi.yes_ask)}`
              : null}
            valueClass="text-amber-300"
          />
          {m.dg?.dg_prob != null && (
            <PriceRow
              label="DataGolf model"
              value={m.dg.dg_prob}
              valueClass="text-sky-300"
            />
          )}
          {m.books?.median != null ? (
            <PriceRow
              label={`Books median (${m.books.count})`}
              value={m.books.median}
              sub={m.books.min != null && m.books.max != null
                ? `range ${fmtPct(m.books.min)}–${fmtPct(m.books.max)}`
                : null}
              valueClass="text-emerald-300"
            />
          ) : m.kalshi != null ? (
            <div className="text-[10px] text-muted-foreground/70 italic py-1">
              No sportsbook prices currently tracked for {MARKET_LABELS[m.market_type] || m.market_type}{m.dg?.dg_prob != null ? " on this market — use the DataGolf model as the fair-price anchor" : ""}.
            </div>
          ) : null}
        </div>

        {(edge != null || dgEdge != null) && (
          <div className="pt-2 border-t border-border/40 space-y-1">
            {edge != null && (
              <PriceRow
                label="Edge vs books"
                value={edge}
                signed
                valueClass={edge > 0 ? "text-emerald-300" : "text-rose-300"}
              />
            )}
            {dgEdge != null && (
              <PriceRow
                label="Edge vs DataGolf"
                value={dgEdge}
                signed
                valueClass={dgEdge > 0 ? "text-emerald-300" : "text-rose-300"}
              />
            )}
          </div>
        )}

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

        {m.data_status === "no_data" && (
          <div className="text-[11px] text-muted-foreground/60 italic">
            Pricing data pending — this market may not have opened yet, or our next ingest cycle hasn't fetched it. Re-checks every 5 minutes.
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
