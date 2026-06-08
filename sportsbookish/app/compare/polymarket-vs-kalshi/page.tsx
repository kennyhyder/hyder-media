import Link from "next/link";
import type { Metadata } from "next";
import { fetchLeagues, fetchPolymarketCompare } from "@/lib/sports-data";
import { affiliateUrl } from "@/lib/affiliates";
import PolymarketPromo from "@/components/PolymarketPromo";
import BrandProfileCard from "@/components/BrandProfileCard";
import FeatureComparisonTable from "@/components/FeatureComparisonTable";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { eventUrl } from "@/lib/slug";
import { BRAND_PROFILES, brandOrganizationLd } from "@/lib/brand-profiles";

const KALSHI = BRAND_PROFILES.kalshi;
const POLY = BRAND_PROFILES.polymarket;

export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ league?: string }> }): Promise<Metadata> {
  const { league } = await searchParams;
  const leaguePrefix = league ? league.toUpperCase() + " · " : "";
  const title = `${leaguePrefix}Kalshi vs Polymarket — live event-contract price comparison`;
  const description = league
    ? `Live ${league.toUpperCase()} odds compared between Kalshi (CFTC-regulated event-contract exchange) and Polymarket (peer-to-peer prediction market). Find mispricings sorted by edge.`
    : "Live event-contract odds compared between Kalshi (CFTC-regulated exchange) and Polymarket (peer-to-peer prediction market) across every active sports market. Sorted by edge — biggest mispricings first.";
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/compare/polymarket-vs-kalshi${league ? `?league=${league}` : ""}` },
    openGraph: { title, description, url: `${SITE_URL}/compare/polymarket-vs-kalshi`, type: "website", siteName: "SportsBookISH" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function fmtPct(v: number | null | undefined, decimals = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}
function fmtPctSigned(v: number | null | undefined, decimals = 2) {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(decimals)}%`;
}

export default async function PolymarketComparePage({ searchParams }: { searchParams: Promise<{ league?: string }> }) {
  const { league } = await searchParams;
  const [leagues, rows] = await Promise.all([
    fetchLeagues(),
    fetchPolymarketCompare(league, 0),
  ]);

  // Top 50 by absolute edge
  const top = rows.slice(0, 100);
  const buyKalshi = top.filter((r) => r.edge_pct > 0).slice(0, 10);
  const buyPoly = top.filter((r) => r.edge_pct < 0).slice(0, 10);

  const faqItems = [
    {
      question: "What's the core difference between Kalshi and Polymarket?",
      answer:
        "Kalshi is a CFTC-regulated US event-contract exchange (Designated Contract Market, same legal classification as the CME) that settles in USD via ACH. Polymarket is a peer-to-peer prediction market that runs on the Polygon blockchain and settles in USDC. Kalshi operates legally in all 50 US states; Polymarket geo-blocks US users after a January 2022 CFTC settlement. The pricing mechanism is structurally similar — both are YES/NO order books with no house counterparty — but liquidity, fees, and user demographics differ enough that the same contract often prices 1–5 percentage points apart.",
    },
    {
      question: "Can US residents legally use Polymarket?",
      answer:
        "Officially, no. Polymarket settled with the CFTC in January 2022 for $1.4M and agreed to geo-block US IP addresses. Some US users circumvent the block via VPN, but doing so violates Polymarket's terms of service, places funds in a jurisdiction with no US consumer-protection framework, and forfeits any US regulatory dispute path. For legal US event-contract trading, Kalshi is the answer — it's federally regulated by the CFTC and operates in every state.",
    },
    {
      question: "How is the Kalshi vs Polymarket edge calculated on this page?",
      answer:
        "For each contestant on each active sports event, we pull the latest Kalshi implied probability (de-vigged from bid/ask midpoint when both sides are quoted, or the last trade price otherwise) and the latest Polymarket implied price (YES contract price). Edge = Polymarket probability − Kalshi probability. A positive edge means Kalshi is pricing the outcome cheaper — buy YES on Kalshi to capture the spread. A negative edge means Polymarket is cheaper.",
    },
    {
      question: "Why don't all sports events show up in the comparison?",
      answer:
        "Polymarket and Kalshi don't cover the same markets one-for-one. We only show rows where BOTH exchanges have a current quote on the same contestant in the same market. Polymarket has historically been heavier on US politics and international markets, while Kalshi has deeper US sports vertical depth. League hub pages (e.g. /sports/nba) show the full Kalshi market — this page is just the overlap.",
    },
    {
      question: "Which has cheaper fees: Kalshi or Polymarket?",
      answer:
        "Depends on position size. Polymarket charges 0% trading fees but you pay Polygon gas (~$0.01–$0.50 per trade) plus on/off-ramp friction if moving between USD and USDC. Kalshi charges 0.07% per side capped at 7¢ per contract (peaks at ~2¢ near 50% probability) but settles directly in USD with no chain costs. For positions over ~30 contracts, Kalshi tends to be cheaper. For small recurring positions, Polymarket's no-fee model often wins net of gas.",
    },
    {
      question: "Do Kalshi and Polymarket prices differ on the same event?",
      answer:
        "Yes — often by 1–5 percentage points on liquid markets, sometimes more on illiquid ones. The gap reflects (a) different user bases (Polymarket is more crypto-native and international; Kalshi is US retail), (b) different fee structures that affect marginal traders' break-even, (c) settlement-currency friction (you can't trivially move dollars to USDC and back), and (d) regulatory arbitrage (US sharps blocked from Polymarket can only express views on Kalshi). SportsBookISH surfaces these gaps whenever both venues list the same market.",
    },
    {
      question: "Is Polymarket safer than Kalshi?",
      answer:
        "From a US regulatory perspective: no. Kalshi is CFTC-registered as a Designated Contract Market with full federal oversight, customer-fund segregation requirements, and US legal recourse for disputes. Polymarket operates outside US jurisdiction — your funds sit in a self-custodial wallet (smart-contract + key-management risk), and there's no US consumer-protection framework if something goes wrong. From a smart-contract / transparency perspective, Polymarket's contracts have been audited and all trades are publicly verifiable on-chain, which some users prefer.",
    },
    {
      question: "Can I arbitrage Kalshi vs Polymarket?",
      answer:
        "Theoretically yes when the two venues price the same event meaningfully apart. Practically: capital lock-up across two platforms in two currencies (USD on Kalshi, USDC on Polymarket), gas fees on Polymarket, and counterparty risk on both sides eat most of the edge for retail-size positions. The arbitrage is real on big political events with 5%+ spreads — but for sports the most reliable signal is using each venue's price as a check on the other rather than capital-intensive arb execution.",
    },
    {
      question: "Which platform has bigger volume?",
      answer:
        "Polymarket has historically traded larger volume — about $8B in 2024, driven primarily by the US presidential election cycle (~$3.6B on Trump vs Harris alone). Kalshi's 2024 volume was roughly $1B, but its US sports vertical launched in late 2024 and grew rapidly through 2025. By raw monthly average, Polymarket is bigger; by US-onshore monthly average, Kalshi leads.",
    },
    {
      question: "Which has better political markets vs sports markets?",
      answer:
        "Politics: Polymarket — both by volume and breadth. Polymarket has historically led on election, primary, and congressional markets with hundreds of millions in volume per major cycle. Sports: Kalshi — deeper US sports coverage with championship futures, MVP, conference winners, and recently per-game markets across all major US leagues. For PGA Tour, Kalshi was first to integrate full-tournament outrights with Top 5/10/20/40 + Make Cut + matchups.",
    },
  ];

  const ldData = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
      { name: "Polymarket vs Kalshi", url: "/compare/polymarket-vs-kalshi" },
    ]),
    faqLd(faqItems),
    brandOrganizationLd(KALSHI),
    brandOrganizationLd(POLY),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Kalshi vs Polymarket — live event-contract price comparison",
      description: "Side-by-side profiles, feature matrix, and live price comparison of Kalshi (CFTC-regulated US event-contract exchange) and Polymarket (peer-to-peer prediction market).",
      author: { "@type": "Person", name: "Kenny Hyder", url: `${SITE_URL}/about/kenny-hyder` },
      publisher: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
      mainEntityOfPage: `${SITE_URL}/compare/polymarket-vs-kalshi`,
      datePublished: "2026-05-12",
      dateModified: new Date().toISOString().slice(0, 10),
    },
  ];

  return (
    <div className="min-h-screen">
      <JsonLd data={ldData} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
          <div className="font-semibold text-sm">Kalshi vs Polymarket</div>
          <div className="w-12" aria-hidden="true" />
        </div>
        <nav aria-label="Filter by league" className="container mx-auto max-w-7xl px-4 pb-3 flex gap-1 overflow-x-auto">
          <Link
            href="/compare/polymarket-vs-kalshi"
            aria-current={!league ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${!league ? "bg-emerald-500 text-emerald-950 font-semibold" : "bg-card/40 border border-border/60 text-muted-foreground hover:text-foreground"}`}
          >
            All sports
          </Link>
          {leagues.map((l) => (
            <Link
              key={l.key}
              href={`/compare/polymarket-vs-kalshi?league=${l.key}`}
              aria-current={league === l.key ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${league === l.key ? "bg-emerald-500 text-emerald-950 font-semibold" : "bg-card/40 border border-border/60 text-muted-foreground hover:text-foreground"}`}
            >
              <span aria-hidden="true">{l.icon}</span> {l.display_name}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="container mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
          {league ? `${league.toUpperCase()}: ` : ""}Kalshi vs Polymarket
        </h1>
        <p className="text-muted-foreground mb-6 max-w-3xl">
          Live event-contract pricing on the {rows.length} contestants where both Kalshi and Polymarket have current quotes. Sorted by edge size — biggest mispricings first.
        </p>

        {/* Trade-with CTAs — affiliate links to both exchanges. Universal on
            every device; the iOS-gated $50 promo card sits further down. */}
        <div className="flex flex-wrap gap-3 mb-6">
          <a
            href={affiliateUrl("kalshi", { campaign: "compare-poly-vs-kalshi" }) || "https://kalshi.com/"}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 transition px-4 py-2 text-sm font-semibold text-amber-300"
            title="Trade on Kalshi (affiliate link)"
          >
            Trade on Kalshi →
          </a>
          <a
            href={affiliateUrl("polymarket", { campaign: "compare-poly-vs-kalshi" }) || "https://polymarket.com/"}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 transition px-4 py-2 text-sm font-semibold text-fuchsia-300"
            title="Trade on Polymarket (affiliate link)"
          >
            Trade on Polymarket →
          </a>
          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground self-center">Sponsored · code <span className="font-mono text-foreground/80">SPORTSBOOKISH</span> on Polymarket (iOS)</span>
        </div>

        {rows.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card/40 p-8 text-center">
            <p className="text-sm text-muted-foreground">No current overlap between Kalshi and Polymarket{league ? ` for ${league.toUpperCase()}` : ""}. Try removing the league filter or check back during an active slate.</p>
          </div>
        )}

        {buyKalshi.length > 0 && (
          <section aria-labelledby="buy-kalshi-heading" className="mb-8">
            <h2 id="buy-kalshi-heading" className="text-sm uppercase tracking-wider text-emerald-400 mb-2">
              <span aria-hidden="true">🟢 </span>Buy on Kalshi (Polymarket prices it higher)
            </h2>
            <ComparisonTable rows={buyKalshi} />
          </section>
        )}

        {/* iOS-only promo card. Hidden on Android/desktop; the universal
            Polymarket CTA above still works for those visitors. */}
        <div className="mb-8 flex justify-center">
          <PolymarketPromo size="300x250" campaign="compare-poly-vs-kalshi" />
        </div>

        {buyPoly.length > 0 && (
          <section aria-labelledby="buy-poly-heading" className="mb-8">
            <h2 id="buy-poly-heading" className="text-sm uppercase tracking-wider text-rose-400 mb-2">
              <span aria-hidden="true">🔴 </span>Sell on Kalshi (Polymarket prices it lower)
            </h2>
            <ComparisonTable rows={buyPoly} />
          </section>
        )}

        {top.length > 20 && (
          <section aria-labelledby="all-rows-heading" className="mb-8">
            <h2 id="all-rows-heading" className="text-sm uppercase tracking-wider text-muted-foreground mb-2">All edges (top {Math.min(top.length, 100)})</h2>
            <ComparisonTable rows={top} />
          </section>
        )}

        {/* Brand profile cards — at-a-glance side-by-side. Pulls from the
            shared brand-profiles registry so a single edit propagates here
            and to every Kalshi-vs-X book page. */}
        <section aria-labelledby="profile-heading" className="mb-10">
          <h2 id="profile-heading" className="text-xl font-semibold mb-1">Platform profiles at a glance</h2>
          <p className="text-sm text-muted-foreground mb-4">Funding, scale, regulation, fees, payments — both venues side-by-side. Updated 2025 Q4 from public filings, official sites, and third-party trackers (Crunchbase, Wikipedia).</p>
          <div className="grid md:grid-cols-2 gap-4">
            <BrandProfileCard profile={KALSHI} campaign="compare-poly-vs-kalshi-profile" accentClass="border-amber-500/40" highlightClass="text-amber-400" />
            <BrandProfileCard profile={POLY} campaign="compare-poly-vs-kalshi-profile" accentClass="border-fuchsia-500/40" highlightClass="text-fuchsia-400" />
          </div>
        </section>

        {/* Dense feature comparison table — every dimension we'd want a
            researcher (or AI overview crawler) to be able to extract. */}
        <section aria-labelledby="features-heading" className="mb-10">
          <h2 id="features-heading" className="text-xl font-semibold mb-3">Feature-by-feature comparison</h2>
          <FeatureComparisonTable left={KALSHI} right={POLY} caption="Side-by-side dimensions that matter when choosing between venues. Volumes are best-effort estimates as of 2025 Q4." />
        </section>

        {/* "When to use which" picker — the decision-tree summary AI overviews
            love to extract. */}
        <section aria-labelledby="usecase-heading" className="mb-10 grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
            <h2 id="usecase-heading" className="text-lg font-semibold text-amber-400 mb-2">Use Kalshi when…</h2>
            <ul className="space-y-2 text-sm list-disc pl-5">
              {KALSHI.bestFor.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-5">
            <h2 className="text-lg font-semibold text-fuchsia-400 mb-2">Use Polymarket when…</h2>
            <ul className="space-y-2 text-sm list-disc pl-5">
              {POLY.bestFor.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </section>

        {/* Detailed strengths / weaknesses — pulled from the same registry. */}
        <section aria-labelledby="pros-cons-heading" className="mb-10">
          <h2 id="pros-cons-heading" className="text-xl font-semibold mb-3">Strengths and trade-offs</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h3 className="text-sm font-semibold text-emerald-400 mb-2">Kalshi strengths</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{KALSHI.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3 className="text-sm font-semibold text-rose-400 mt-4 mb-2">Kalshi trade-offs</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{KALSHI.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h3 className="text-sm font-semibold text-emerald-400 mb-2">Polymarket strengths</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{POLY.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              <h3 className="text-sm font-semibold text-rose-400 mt-4 mb-2">Polymarket trade-offs</h3>
              <ul className="space-y-1.5 text-sm list-disc pl-5">{POLY.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="mb-10">
          <h2 id="faq-heading" className="text-xl font-semibold mb-3">Frequently asked questions</h2>
          <dl className="space-y-3">
            {faqItems.map((f) => (
              <div key={f.question} className="rounded border border-border/60 bg-card/40 px-4 py-3">
                <dt className="font-medium text-sm">{f.question}</dt>
                <dd className="text-sm text-muted-foreground mt-1 leading-relaxed">{f.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Citation footer — gives crawlers + readers the source trail. */}
        <section aria-labelledby="sources-heading" className="mb-10 rounded-lg border border-border/60 bg-card/30 p-5">
          <h2 id="sources-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sources and further reading</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold text-amber-400 mb-1">Kalshi</h3>
              <ul className="space-y-1">
                {KALSHI.sources.map((s) => (
                  <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">{s.label} ↗</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-fuchsia-400 mb-1">Polymarket</h3>
              <ul className="space-y-1">
                {POLY.sources.map((s) => (
                  <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">{s.label} ↗</a></li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            All figures best-effort as of {KALSHI.asOf}. Funding totals, valuations, and volume are sourced from public filings, official company communications, and third-party trackers (Crunchbase, Wikipedia). Re-verify against primary sources before quoting in compliance-sensitive contexts.
          </p>
        </section>
      </main>
    </div>
  );
}

function ComparisonTable({ rows }: { rows: { league: string; event_id: string; event_title: string; event_slug: string | null; season_year: number | null; contestant_label: string; kalshi_prob: number; polymarket_prob: number; polymarket_volume_usd: number | null; edge_pct: number }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-card/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="text-left px-3 py-2">Contestant</th>
            <th scope="col" className="text-left px-3 py-2">Event</th>
            <th scope="col" className="text-right px-3 py-2">
              <a href={affiliateUrl("kalshi", { campaign: "compare-poly-vs-kalshi-th" }) || "https://kalshi.com/"} target="_blank" rel="sponsored noopener noreferrer" className="hover:text-amber-400" title="Trade on Kalshi (affiliate link)">Kalshi ↗</a>
            </th>
            <th scope="col" className="text-right px-3 py-2">
              <a href={affiliateUrl("polymarket", { campaign: "compare-poly-vs-kalshi-th" }) || "https://polymarket.com/"} target="_blank" rel="sponsored noopener noreferrer" className="hover:text-fuchsia-400" title="Trade on Polymarket (affiliate link)">Polymarket ↗</a>
            </th>
            <th scope="col" className="text-right px-3 py-2">Edge</th>
            <th scope="col" className="text-right px-3 py-2">Poly vol</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = r.event_slug && r.season_year
              ? eventUrl(r.league, r.season_year, r.event_slug)
              : `/sports/${r.league}/event/${r.event_id}`;
            const edgeClass = r.edge_pct > 0 ? "text-emerald-400" : r.edge_pct < 0 ? "text-rose-400" : "";
            return (
              <tr key={`${r.event_id}-${r.contestant_label}`} className="border-t border-border/40">
                <th scope="row" className="text-left px-3 py-2 font-medium">{r.contestant_label}</th>
                <td className="px-3 py-2 text-muted-foreground">
                  <Link href={href} className="hover:text-emerald-400 hover:underline">{r.event_title}</Link>
                </td>
                <td className="text-right px-3 py-2 font-mono tabular-nums text-amber-500">{fmtPct(r.kalshi_prob)}</td>
                <td className="text-right px-3 py-2 font-mono tabular-nums">{fmtPct(r.polymarket_prob)}</td>
                <td className={`text-right px-3 py-2 font-mono tabular-nums font-semibold ${edgeClass}`}>{fmtPctSigned(r.edge_pct)}</td>
                <td className="text-right px-3 py-2 font-mono tabular-nums text-muted-foreground text-xs">
                  {r.polymarket_volume_usd ? `$${Math.round(r.polymarket_volume_usd / 1000)}k` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
