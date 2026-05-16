import Link from "next/link";
import type { Metadata } from "next";
import { fetchLeagues, fetchPolymarketCompare } from "@/lib/sports-data";
import { JsonLd, breadcrumbLd, faqLd } from "@/lib/seo";
import { eventUrl } from "@/lib/slug";

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
      question: "How is Kalshi vs Polymarket calculated?",
      answer: "For each contestant on each active sports event, we pull the latest Kalshi implied probability (de-vigged if both bid/ask are present) and the latest Polymarket implied price. Edge = Polymarket probability − Kalshi probability. A positive edge means Kalshi is priced cheaper — buy YES on Kalshi to capture the spread.",
    },
    {
      question: "Why don't all events show up?",
      answer: "Polymarket and Kalshi don't cover the same markets one-for-one. We only show rows where BOTH exchanges have a current quote on the same contestant. Polymarket leans toward big political/cultural events; Kalshi has deeper sports coverage. League pages still show the full Kalshi market — this page is just the overlap.",
    },
    {
      question: "What's the difference between Kalshi and Polymarket?",
      answer: "Kalshi is a CFTC-regulated US event-contract exchange with order books, fees, and dollar settlement. Polymarket is a peer-to-peer prediction market on Polygon (a crypto layer-2). Prices can differ because of liquidity, fee structure, and user demographics. Sharp users arbitrage the gap — that's what this page surfaces.",
    },
  ];

  const ldData = [
    breadcrumbLd([
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
      { name: "Polymarket vs Kalshi", url: "/compare/polymarket-vs-kalshi" },
    ]),
    faqLd(faqItems),
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

        <section aria-labelledby="faq-heading" className="mb-10">
          <h2 id="faq-heading" className="text-xl font-semibold mb-3">FAQ</h2>
          <dl className="space-y-3">
            {faqItems.map((f) => (
              <div key={f.question} className="rounded border border-border/60 bg-card/40 px-4 py-3">
                <dt className="font-medium text-sm">{f.question}</dt>
                <dd className="text-sm text-muted-foreground mt-1">{f.answer}</dd>
              </div>
            ))}
          </dl>
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
            <th scope="col" className="text-right px-3 py-2">Kalshi</th>
            <th scope="col" className="text-right px-3 py-2">Polymarket</th>
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
