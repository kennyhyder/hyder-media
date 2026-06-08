import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  parseSlug, allSportsbookSlugs, ALL_BOOK_KEYS,
  SPORTSBOOKS, EXCHANGES,
} from "@/lib/sportsbook-meta";
import { fetchComparisonEvents } from "@/lib/sportsbook-comparison-data";
import { fmtPct, fmtAmerican } from "@/lib/format";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { LastUpdated, datasetFreshnessLd } from "@/components/LastUpdated";
import { affiliateUrl } from "@/lib/affiliates";
import { getBrandProfile, brandOrganizationLd, type BrandProfile } from "@/lib/brand-profiles";
import BrandProfileCard from "@/components/BrandProfileCard";
import FeatureComparisonTable from "@/components/FeatureComparisonTable";
import TradingCtaRow from "@/components/TradingCtaRow";
import PolymarketPromo from "@/components/PolymarketPromo";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return allSportsbookSlugs().map((slug) => ({ slug }));
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

interface PageProps { params: Promise<{ slug: string }> }

function titleForSlug(parsed: NonNullable<ReturnType<typeof parseSlug>>): { title: string; description: string; h1: string } {
  switch (parsed.type) {
    case "single": {
      const b = parsed.primary;
      return {
        title: `${b.name} Review 2026 — Odds, Markets & Live Comparison | SportsBookISH`,
        description: `${b.name} sportsbook review with live odds from current MLB, NBA, NFL and NHL games. Compare ${b.name} against Kalshi, Polymarket and other regulated US sportsbooks side by side.`,
        h1: `${b.name} Review — Live Odds Comparison vs Kalshi, Polymarket & Other Sportsbooks`,
      };
    }
    case "book_vs_book": {
      const a = parsed.primary as typeof parsed.primary & { name: string };
      const b = parsed.secondary!;
      return {
        title: `${a.name} vs ${b.name} — Live Odds Comparison 2026 | SportsBookISH`,
        description: `Live ${a.name} vs ${b.name} odds across MLB, NBA, NFL and NHL games happening right now. Kalshi and Polymarket overlays included — see which book is offering the best price on each market.`,
        h1: `${a.name} vs ${b.name} — Live Odds Side-by-Side`,
      };
    }
    case "kalshi_vs_book": {
      const b = parsed.secondary!;
      return {
        title: `Kalshi vs ${b.name} — Live Odds & EV Comparison | SportsBookISH`,
        description: `Compare Kalshi event-contract prices against ${b.name} sportsbook lines in real time. Find +EV opportunities where the regulated exchange disagrees with ${b.name} pricing.`,
        h1: `Kalshi vs ${b.name} — Where Event-Contract Prices Beat ${b.name} Lines`,
      };
    }
    case "polymarket_vs_book": {
      const b = parsed.secondary!;
      return {
        title: `Polymarket vs ${b.name} — Live Odds Comparison | SportsBookISH`,
        description: `Polymarket sports market prices side-by-side with ${b.name}. See where the largest crypto-rails prediction market diverges from traditional sportsbook pricing.`,
        h1: `Polymarket vs ${b.name} — Prediction-Market Odds vs Sportsbook Lines`,
      };
    }
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: "Sportsbook — SportsBookISH" };
  const { title, description } = titleForSlug(parsed);
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/sportsbooks/${slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/sportsbooks/${slug}`,
      siteName: "SportsBookISH",
      type: "article",
    },
  };
}

function buildFaq(parsed: NonNullable<ReturnType<typeof parseSlug>>): Array<{ question: string; answer: string }> {
  // SportsbookMeta has promo_summary; exchange meta doesn't — guard with ??.
  const promo = (e: { promo_summary?: string }) => e.promo_summary ?? "Current offers vary; check the operator's site for the latest";
  switch (parsed.type) {
    case "single": {
      const b = parsed.primary as { name: string; license: string; promo_summary?: string };
      return [
        { question: `Is ${b.name} legal in the US?`, answer: `Yes. ${b.name} operates under state-issued sports betting licenses. ${b.license}` },
        { question: `What is the ${b.name} welcome offer?`, answer: `${promo(b)}. Offers vary by state and are subject to change — check ${b.name} directly for the current promotion.` },
        { question: `Does ${b.name} have the best odds?`, answer: `No single book has the best price on every market. SportsBookISH compares ${b.name} lines against other regulated US sportsbooks plus Kalshi and Polymarket so you can see which book is sharpest on each event in real time.` },
        { question: `How is Kalshi different from ${b.name}?`, answer: `Kalshi is a CFTC-regulated event-contracts exchange — sports outcomes trade as contracts between users, not against the house. There's no traditional vig; you buy YES or NO at a market-set price. Compared with ${b.name}, Kalshi prices often diverge by 3-10pp on regular-season markets — that's where the EV opportunity is.` },
      ];
    }
    case "book_vs_book": {
      const a = parsed.primary as { name: string; promo_summary?: string };
      const b = parsed.secondary!;
      return [
        { question: `${a.name} vs ${b.name} — which has better odds?`, answer: `Neither consistently wins. Across MLB and NBA moneylines, ${a.name} and ${b.name} prices typically agree within 1-2pp, with each beating the other on roughly half the markets. The biggest gaps appear on player props and futures where market depth differs.` },
        { question: `Should I have accounts at both?`, answer: `Yes — line shopping between major regulated US books captures 2-5% extra EV over a season. The 90 seconds it takes to check both before placing a bet is the highest-hourly-rate work in regulated betting.` },
        { question: `Which book has better promotions?`, answer: `Both offer competitive new-user offers (${promo(a)} vs ${promo(b)}). Ongoing promos cycle: ${a.name} historically runs more SGP boosts; ${b.name} runs more odds-boost specials on chalk parlays.` },
        { question: `How do exchange prices (Kalshi, Polymarket) compare?`, answer: `Kalshi and Polymarket frequently price 3-10pp off both ${a.name} and ${b.name} on the same market. SportsBookISH overlays the exchange prices on every event so you can spot when the sportsbooks are out of step with the regulated exchange consensus.` },
      ];
    }
    case "kalshi_vs_book": {
      const b = parsed.secondary!;
      return [
        { question: `What is Kalshi?`, answer: `Kalshi is a CFTC-regulated event-contracts exchange. Users buy and sell YES/NO contracts on real-world outcomes — including sports — at market-set prices. There's no traditional sportsbook vig; the spread is bid/ask between users.` },
        { question: `Is Kalshi better than ${b.name}?`, answer: `Different products. ${b.name} is a sportsbook with the house as counterparty (vig built in). Kalshi is an exchange (no house). Kalshi prices often beat ${b.name}'s no-vig fair line by 2-8pp on regular-season major-league moneylines, and the gap widens on futures.` },
        { question: `Can I use both Kalshi and ${b.name}?`, answer: `Yes. They're operated separately under different regulators (Kalshi: CFTC federal; ${b.name}: state gaming commissions). Many users hold accounts at both and arbitrage when prices diverge meaningfully.` },
        { question: `What's the typical Kalshi-vs-${b.name} edge?`, answer: `Median absolute gap on major-league moneylines is 2-4pp. Tails of the distribution (10pp+ gaps) appear roughly 5% of markets. SportsBookISH live-tracks every gap and alerts on the largest divergences.` },
      ];
    }
    case "polymarket_vs_book": {
      const b = parsed.secondary!;
      return [
        { question: `What is Polymarket?`, answer: `Polymarket is a CFTC-regulated crypto-settled prediction market platform. It's the largest peer-to-peer prediction market by volume globally, with growing US sports verticals.` },
        { question: `How does Polymarket pricing compare to ${b.name}?`, answer: `Polymarket prices are set by traders, not the house. On major NBA and NFL markets, Polymarket and ${b.name} usually price within 2-3pp on game lines. Spread/totals and player-prop coverage is thinner on Polymarket today.` },
        { question: `Is Polymarket easier or harder to use than ${b.name}?`, answer: `Higher friction at signup (USDC funding required) but lower friction once active (no withdrawal limits, no game/prop blocking). ${b.name} is the friendlier on-ramp; Polymarket is the deeper pool once you're set up.` },
        { question: `Where is the edge?`, answer: `Polymarket disagreements with ${b.name} of 4pp+ on major-league moneylines are real signal — Polymarket users are sharper on average than ${b.name}'s retail-skewed action. SportsBookISH overlays Polymarket alongside Kalshi and ${b.name} so the divergences are visible side-by-side.` },
      ];
    }
  }
}

export default async function SportsbookComparisonPage({ params }: PageProps) {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) notFound();

  const { title, description, h1 } = titleForSlug(parsed);

  // Determine which book keys we need in the table.
  const bookKeysForTable = parsed.type === "single"
    ? [parsed.primary.key]
    : parsed.type === "book_vs_book"
      ? [parsed.primary.key, parsed.secondary!.key]
      : parsed.type === "kalshi_vs_book"
        ? [parsed.secondary!.key]
        : [parsed.secondary!.key]; // polymarket_vs_book

  const events = await fetchComparisonEvents({ bookKeys: bookKeysForTable, perLeagueLimit: 4 });
  const renderTime = new Date().toISOString();
  const faqItems = buildFaq(parsed)!;

  // Pull deep brand profiles from the central registry. The registry is the
  // source of truth for funding/scale/regulator/citations; sportsbook-meta.ts
  // is the thin promo-summary layer used for tabular display.
  const primaryProfile: BrandProfile | null = getBrandProfile(parsed.primary.key);
  const secondaryProfile: BrandProfile | null = parsed.secondary ? getBrandProfile(parsed.secondary.key) : null;

  return (
    <div className="min-h-screen">
      <JsonLd data={breadcrumbLd([
        { name: "Home", url: SITE_URL },
        { name: "Sportsbooks", url: `${SITE_URL}/sportsbooks` },
        { name: parsed.primary.name + (parsed.secondary ? ` vs ${parsed.secondary.name}` : ""), url: `${SITE_URL}/sportsbooks/${slug}` },
      ])} />
      <JsonLd data={faqLd(faqItems)} />
      <JsonLd data={datasetFreshnessLd({
        name: title,
        description,
        pageUrl: `${SITE_URL}/sportsbooks/${slug}`,
        dateModified: renderTime,
      })} />
      {primaryProfile && <JsonLd data={brandOrganizationLd(primaryProfile)} />}
      {secondaryProfile && <JsonLd data={brandOrganizationLd(secondaryProfile)} />}
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        author: { "@type": "Person", name: "Kenny Hyder", url: `${SITE_URL}/about/kenny-hyder` },
        publisher: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
        mainEntityOfPage: `${SITE_URL}/sportsbooks/${slug}`,
        datePublished: "2026-05-12",
        dateModified: renderTime.slice(0, 10),
      }} />

      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4 gap-2">
          <Link href="/sportsbooks" className="text-sm text-muted-foreground hover:text-foreground shrink-0">← Sportsbooks</Link>
          <div className="font-semibold text-sm truncate">{parsed.primary.name}{parsed.secondary ? ` vs ${parsed.secondary.name}` : ""}</div>
          <LastUpdated iso={renderTime} variant="header" />
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-6 space-y-8">
        {/* H1 + intro */}
        <section>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight">{h1}</h1>
          <p className="text-muted-foreground mt-3 max-w-3xl">{description}</p>
        </section>

        {/* Top-of-page CTAs — universal Trade-on-Kalshi/Polymarket affiliate
            links plus, for kalshi-vs-X or polymarket-vs-X pages, an inline
            iOS-gated $50 Polymarket promo card. */}
        <section>
          <TradingCtaRow
            campaign={`sportsbooks-${slug}`}
            showKalshi={true}
            showPolymarket={parsed.type === "polymarket_vs_book" || parsed.type === "single"}
          />
        </section>

        {/* Deep brand profiles. Falls back to the thin BookFacts card for
            any brand not in the registry (shouldn't happen — all major
            brands are now seeded). */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {primaryProfile
            ? <BrandProfileCard profile={primaryProfile} campaign={`sportsbooks-${slug}-profile`} accentClass={parsed.type.includes("kalshi") ? "border-amber-500/40" : parsed.type.includes("polymarket") ? "border-fuchsia-500/40" : "border-emerald-500/40"} highlightClass={parsed.type.includes("kalshi") ? "text-amber-400" : parsed.type.includes("polymarket") ? "text-fuchsia-400" : "text-emerald-400"} />
            : <BookFacts entity={parsed.primary} kind={parsed.type === "kalshi_vs_book" || parsed.type === "polymarket_vs_book" ? "exchange" : "book"} />}
          {parsed.secondary && (
            secondaryProfile
              ? <BrandProfileCard profile={secondaryProfile} campaign={`sportsbooks-${slug}-profile`} accentClass="border-emerald-500/40" highlightClass="text-emerald-400" />
              : <BookFacts entity={parsed.secondary} kind="book" />
          )}
        </section>

        {/* Feature-by-feature comparison table — only renders on vs pages
            where both sides exist in the registry. */}
        {primaryProfile && secondaryProfile && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Feature-by-feature comparison</h2>
            <FeatureComparisonTable
              left={primaryProfile}
              right={secondaryProfile}
              caption={`Side-by-side dimensions that matter when choosing between ${primaryProfile.name} and ${secondaryProfile.name}. Volumes are best-effort as of ${primaryProfile.asOf}.`}
            />
          </section>
        )}

        {/* "When to use which" picker — drives AI-overview-friendly extracts. */}
        {primaryProfile && secondaryProfile && (
          <section className="grid md:grid-cols-2 gap-4">
            <div className={`rounded-lg border p-5 ${parsed.type.includes("kalshi") ? "border-amber-500/30 bg-amber-500/5" : parsed.type.includes("polymarket") ? "border-fuchsia-500/30 bg-fuchsia-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              <h2 className={`text-lg font-semibold mb-2 ${parsed.type.includes("kalshi") ? "text-amber-400" : parsed.type.includes("polymarket") ? "text-fuchsia-400" : "text-emerald-400"}`}>Use {primaryProfile.name} when…</h2>
              <ul className="space-y-2 text-sm list-disc pl-5">
                {primaryProfile.bestFor.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h2 className="text-lg font-semibold text-emerald-400 mb-2">Use {secondaryProfile.name} when…</h2>
              <ul className="space-y-2 text-sm list-disc pl-5">
                {secondaryProfile.bestFor.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          </section>
        )}

        {/* Strengths & trade-offs side-by-side (vs pages) or stacked (single). */}
        {primaryProfile && (
          <section className={parsed.secondary && secondaryProfile ? "grid md:grid-cols-2 gap-4" : ""}>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h3 className="text-sm font-semibold text-emerald-400 mb-2">{primaryProfile.name} strengths</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{primaryProfile.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3 className="text-sm font-semibold text-rose-400 mt-4 mb-2">{primaryProfile.name} trade-offs</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{primaryProfile.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            {parsed.secondary && secondaryProfile && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
                <h3 className="text-sm font-semibold text-emerald-400 mb-2">{secondaryProfile.name} strengths</h3>
                <ul className="space-y-1.5 text-sm list-disc pl-5">{secondaryProfile.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
                <h3 className="text-sm font-semibold text-rose-400 mt-4 mb-2">{secondaryProfile.name} trade-offs</h3>
                <ul className="space-y-1.5 text-sm list-disc pl-5">{secondaryProfile.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </section>
        )}

        {/* iOS-only Polymarket bonus card — shows on polymarket-vs-X pages
            and the standalone polymarket review (parsed.type === "single"
            with primary.key === "polymarket"). */}
        {(parsed.type === "polymarket_vs_book" || (parsed.type === "single" && parsed.primary.key === "polymarket")) && (
          <section className="flex justify-center">
            <PolymarketPromo size="300x250" campaign={`sportsbooks-${slug}`} />
          </section>
        )}

        {/* Live odds table */}
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Live Odds — Next 72 Hours</span>
                <span className="text-xs font-normal text-muted-foreground">Refreshed live; Kalshi/books typically refresh every 5-30 min</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {events.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  No active games in the next 72 hours across MLB, NBA, NFL, NHL, or NCAA football. Check back during in-season weeks for live comparison data.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Game</th>
                      <th className="px-3 py-2 text-right">Kalshi</th>
                      <th className="px-3 py-2 text-right">Polymarket</th>
                      {bookKeysForTable.map((k) => (
                        <th key={k} className="px-3 py-2 text-right">{SPORTSBOOKS[k].name}</th>
                      ))}
                      <th className="px-3 py-2 text-right">Other Books</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {events.flatMap((e) => e.contestants.map((c) => (
                      <tr key={`${e.event_id}|${c.contestant}`} className="hover:bg-muted/40">
                        <td className="px-3 py-2">
                          <div className="text-foreground font-medium">{c.contestant}</div>
                          <div className="text-[10px] text-muted-foreground">{e.league_display} · {e.title}{e.start_time ? ` · ${new Date(e.start_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-400">{fmtPct(c.kalshi_pct, 1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-purple-400">{fmtPct(c.polymarket_pct, 1)}</td>
                        {bookKeysForTable.map((bk) => {
                          const p = c.book_prices[bk];
                          return (
                            <td key={bk} className="px-3 py-2 text-right tabular-nums">
                              {p ? (
                                <div>
                                  <div className="text-foreground">{fmtPct(p.novig, 1)}</div>
                                  <div className="text-[10px] text-muted-foreground">{fmtAmerican(p.american)}</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground/80">
                          {c.book_prices.other ? (
                            <div>
                              <div>{fmtPct(c.book_prices.other.novig, 1)}</div>
                              <div className="text-[10px]">{fmtAmerican(c.book_prices.other.american)}</div>
                            </div>
                          ) : "—"}
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Tradeoff section per slug type */}
        <section className="prose prose-invert max-w-none">
          <ContextNarrative parsed={parsed} />
        </section>

        {/* FAQ */}
        <section>
          <h2 className="text-xl font-bold mb-3">FAQ</h2>
          <Card>
            <CardContent className="divide-y divide-border/40 p-0">
              {faqItems.map((f, i) => (
                <div key={i} className="p-4">
                  <div className="font-semibold mb-1">{f.question}</div>
                  <div className="text-sm text-muted-foreground">{f.answer}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Sources & citations — feeds AI overviews + Perplexity with a
            verifiable trail back to primary sources. */}
        {(primaryProfile || secondaryProfile) && (
          <section className="rounded-lg border border-border/60 bg-card/30 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sources and further reading</h2>
            <div className={`grid gap-4 text-sm ${primaryProfile && secondaryProfile ? "md:grid-cols-2" : ""}`}>
              {primaryProfile && (
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{primaryProfile.name}</h3>
                  <ul className="space-y-1">
                    {primaryProfile.sources.map((s) => (
                      <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">{s.label} ↗</a></li>
                    ))}
                  </ul>
                </div>
              )}
              {secondaryProfile && (
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{secondaryProfile.name}</h3>
                  <ul className="space-y-1">
                    {secondaryProfile.sources.map((s) => (
                      <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">{s.label} ↗</a></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              All figures best-effort as of {(primaryProfile || secondaryProfile)?.asOf}. Funding, valuations, and volume are sourced from public filings, official communications, and third-party trackers (Crunchbase, Wikipedia). Affiliate disclosure: SportsBookISH may receive a referral commission when readers sign up for a regulated sportsbook or prediction market via links on this page.
            </p>
          </section>
        )}

        {/* Related comparisons */}
        <RelatedLinks parsed={parsed} />

        {/* Affiliate CTA */}
        <AffiliateCta parsed={parsed} />
      </main>
    </div>
  );
}

function BookFacts({ entity, kind }: { entity: { key: string; name: string; parent?: string; launched: number; primary_states: string; market_depth: string; edge: string; cons: string; license: string }; kind: "book" | "exchange" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>{entity.name}</span>
          <Badge variant="outline" className="text-xs">{kind === "exchange" ? "Exchange" : "Sportsbook"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <div><span className="text-muted-foreground">Parent:</span> {entity.parent || "—"}</div>
        <div><span className="text-muted-foreground">Launched:</span> {entity.launched}</div>
        <div><span className="text-muted-foreground">Markets:</span> {entity.primary_states}</div>
        <div><span className="text-muted-foreground">Depth:</span> {entity.market_depth}</div>
        <div><span className="text-emerald-400">Edge:</span> {entity.edge}</div>
        <div><span className="text-rose-400">Tradeoff:</span> {entity.cons}</div>
        <div className="text-xs text-muted-foreground/80 pt-1">{entity.license}</div>
      </CardContent>
    </Card>
  );
}

function ContextNarrative({ parsed }: { parsed: NonNullable<ReturnType<typeof parseSlug>> }) {
  if (parsed.type === "single") {
    return (
      <>
        <h2>What makes {parsed.primary.name} different</h2>
        <p>{parsed.primary.edge} The tradeoff: {parsed.primary.cons.toLowerCase()}</p>
        <h3>How {parsed.primary.name} compares to Kalshi</h3>
        <p>{parsed.primary.name} is a traditional state-regulated sportsbook — you bet against the house, and prices include vig (typically 4-5% on standard game lines). Kalshi is a CFTC-regulated event-contracts exchange where prices are set by user bid/ask; there's no traditional vig, just spread. On the same MLB or NBA moneyline, Kalshi mid-prices often beat {parsed.primary.name}'s no-vig fair line by 2-8 percentage points, with the gap widening on futures and player props.</p>
      </>
    );
  }
  if (parsed.type === "book_vs_book") {
    const a = parsed.primary; const b = parsed.secondary!;
    return (
      <>
        <h2>{a.name} vs {b.name} — practical differences</h2>
        <p>{a.name}: {a.edge.toLowerCase()} {b.name}: {b.edge.toLowerCase()} For most regulated US bettors the right strategy is to hold accounts at both and line shop — neither book consistently leads on every market.</p>
        <h3>Where the gaps appear</h3>
        <p>Game lines (h2h, spreads, totals) on major-league sports usually agree within 1-2 percentage points between {a.name} and {b.name} — the books pull from similar pricing services and adjust against each other in real time. Player props and futures are where divergence shows up: market depth differs, and one book will price stale relative to the other for hours at a time when news drops.</p>
      </>
    );
  }
  const exchange = parsed.primary as { name: string };
  const book = parsed.secondary!;
  return (
    <>
      <h2>{exchange.name} vs {book.name} — where the EV lives</h2>
      <p>{exchange.name} is an event-contracts exchange — sports outcomes trade as YES/NO contracts at user-set prices. {book.name} is a state-licensed sportsbook — you're betting against the house at vigged prices. The structural difference means {exchange.name} and {book.name} regularly disagree by 3-10pp on the same market.</p>
      <p>SportsBookISH overlays both side-by-side so the gaps are visible without manually pulling up two apps. Median absolute gap on major-league moneylines is around 3-4pp; the tails (10pp+ divergences) appear in roughly 5% of open markets and are usually where the meaningful edge sits.</p>
    </>
  );
}

function RelatedLinks({ parsed }: { parsed: NonNullable<ReturnType<typeof parseSlug>> }) {
  // Suggest the OTHER comparison angles for whichever book(s) this page is about
  const relevantBooks = parsed.type === "single" || parsed.type === "kalshi_vs_book" || parsed.type === "polymarket_vs_book"
    ? [parsed.secondary?.key ?? parsed.primary.key]
    : [parsed.primary.key, parsed.secondary!.key];

  const cells: Array<{ slug: string; label: string }> = [];
  for (const bk of relevantBooks) {
    cells.push({ slug: `kalshi-vs-${bk}`, label: `Kalshi vs ${SPORTSBOOKS[bk].name}` });
    cells.push({ slug: `polymarket-vs-${bk}`, label: `Polymarket vs ${SPORTSBOOKS[bk].name}` });
    for (const other of ALL_BOOK_KEYS) {
      if (other === bk) continue;
      const ordered = [bk, other].sort();
      cells.push({ slug: `${ordered[0]}-vs-${ordered[1]}`, label: `${SPORTSBOOKS[ordered[0]].name} vs ${SPORTSBOOKS[ordered[1]].name}` });
    }
  }
  // Dedupe by slug
  const unique = Array.from(new Map(cells.map((c) => [c.slug, c])).values()).slice(0, 12);

  return (
    <section>
      <h2 className="text-xl font-bold mb-3">Related comparisons</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {unique.map((c) => (
          <Link key={c.slug} href={`/sportsbooks/${c.slug}`} className="block p-3 rounded-md border border-border/40 hover:bg-muted/40 text-sm">
            {c.label} →
          </Link>
        ))}
      </div>
    </section>
  );
}

function AffiliateCta({ parsed }: { parsed: NonNullable<ReturnType<typeof parseSlug>> }) {
  // Only render CTA for regulated books (offshore/exchange have different flows)
  const ctaBooks = parsed.type === "single" ? [parsed.primary.key]
    : parsed.type === "book_vs_book" ? [parsed.primary.key, parsed.secondary!.key]
    : [parsed.secondary!.key];
  return (
    <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
      <h2 className="text-lg font-semibold mb-2">Ready to line-shop?</h2>
      <p className="text-sm text-muted-foreground mb-4">SportsBookISH pulls live odds from every regulated US book + Kalshi + Polymarket on every event. Compare them all in one place.</p>
      <div className="flex flex-wrap gap-2">
        {ctaBooks.map((k) => {
          const meta = SPORTSBOOKS[k];
          const url = affiliateUrl(k, { campaign: `sportsbooks-${k}` });
          return url ? (
            <a key={k} href={url} target="_blank" rel="sponsored noopener noreferrer"
              className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-600 text-emerald-950 text-sm font-medium">
              Open {meta.name} →
            </a>
          ) : null;
        })}
        <Link href="/sports" className="px-4 py-2 rounded-md border border-border/60 hover:bg-muted text-sm font-medium">
          Live comparison dashboard →
        </Link>
      </div>
    </section>
  );
}
