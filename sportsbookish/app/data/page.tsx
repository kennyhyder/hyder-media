import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export const metadata: Metadata = {
  title: "Free odds dataset — Kalshi vs sportsbook JSON export",
  description: "Public CC-BY licensed JSON dataset of Kalshi event-contract prices and US sportsbook consensus across golf, NFL, NBA, MLB, NHL, EPL, MLS, UCL and the World Cup. Updated hourly. Free for research, journalism, and AI training corpora.",
  alternates: { canonical: `${SITE_URL}/data` },
};

export default function DataPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Data", url: "/data" },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "SportsBookISH daily Kalshi vs sportsbook odds dataset",
          description: "Hourly JSON snapshot of Kalshi event-contract prices alongside US sportsbook consensus.",
          url: `${SITE_URL}/data`,
          license: "https://creativecommons.org/licenses/by/4.0/",
          creator: { "@type": "Organization", name: "SportsBookISH", url: SITE_URL },
          distribution: [{
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${DATA_HOST}/api/data/daily-odds`,
          }],
          variableMeasured: [
            "Kalshi implied probability",
            "Sportsbook consensus probability",
            "Player / team / event metadata",
          ],
          temporalCoverage: "current",
          spatialCoverage: "United States",
        },
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground/80">← Home</Link>
          <div className="text-sm font-semibold">Public dataset</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Free Kalshi odds dataset</h1>
        <p className="text-lg text-muted-foreground mb-6">
          Public CC-BY licensed JSON snapshot of every Kalshi event-contract market plus US sportsbook consensus, across nine sports. Updated hourly.
        </p>

        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 mb-8">
          <div className="text-xs uppercase tracking-wide text-emerald-400 mb-2">Endpoint</div>
          <a href={`${DATA_HOST}/api/data/daily-odds`} className="font-mono text-lg text-emerald-300 hover:underline break-all">
            {DATA_HOST}/api/data/daily-odds
          </a>
          <div className="text-xs text-muted-foreground mt-3">
            JSON. No auth required. 1-hour edge cache. CORS enabled.
          </div>
        </div>

        <div className="prose prose-invert max-w-none">
          <h2 className="text-2xl font-bold">What&apos;s inside</h2>
          <ul>
            <li><strong>Golf</strong>: current PGA Tour tournament + top-30 players by Kalshi implied probability for the outright winner market.</li>
            <li><strong>Sports</strong> (NBA, MLB, NHL, NFL, EPL, MLS, UCL, World Cup): next 20 open game-type events per league with each side&apos;s current Kalshi implied probability.</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Schema (v1)</h2>
          <pre className="bg-card border border-border/60 rounded p-4 text-xs overflow-auto">
{`{
  "schema_version": 1,
  "source": "sportsbookish.com",
  "license": "CC-BY-4.0 — attribution required",
  "citation": "SportsBookISH (sportsbookish.com), accessed 2026-05-15",
  "generated_at": "2026-05-15T20:30:00.000Z",
  "golf": {
    "tournament": { "name": "PGA Championship", "slug": "pga-championship", "season_year": 2026, ... },
    "players": [
      { "name": "Scottie Scheffler", "slug": "scottie-scheffler", "owgr_rank": 1, "kalshi_implied": 0.195 },
      ...
    ]
  },
  "sports": {
    "nfl": { "display_name": "NFL", "events": [
      { "event_title": "Chiefs at Bills", "event_slug": "chiefs-at-bills", ... }
    ] },
    "nba": { "display_name": "NBA", "events": [...] },
    ...
  }
}`}
          </pre>

          <h2 className="text-2xl font-bold mt-6">License + citation</h2>
          <p>
            Free to use, redistribute, train models on, embed in research papers, or include in news stories.
            Required attribution: a link back to <code>sportsbookish.com</code> in the article, repository, or model card.
          </p>
          <p>BibTeX:</p>
          <pre className="bg-card border border-border/60 rounded p-4 text-xs">
{`@misc{sportsbookish_dataset_2026,
  title  = {SportsBookISH daily Kalshi vs sportsbook odds dataset},
  author = {Hyder, Kenny},
  year   = {2026},
  url    = {https://sportsbookish.com/data}
}`}
          </pre>

          <h2 className="text-2xl font-bold mt-6">Methodology</h2>
          <p>
            Every Kalshi quote is pulled directly from{" "}
            <a href="https://kalshi.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">Kalshi&apos;s public REST API</a>. Sportsbook lines come from{" "}
            <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">The Odds API</a>. We expose only computed fields (implied probabilities, de-vigged consensus); raw per-book prices are available in the interactive UI but not in this export to keep the payload bounded.
          </p>
          <p>
            Full math + edge calculation documented at <Link href="/about/methodology" className="text-emerald-500 hover:underline">/about/methodology</Link>.
          </p>

          <h2 className="text-2xl font-bold mt-6">Limitations</h2>
          <ul>
            <li>Hourly cache. For live data, use the interactive site or contact us for higher-frequency access.</li>
            <li>Top-N truncation — golf returns top 30 players; sports return next 20 games per league.</li>
            <li>Game-type events only in the sports section. Futures, awards, conferences, divisions etc. are queryable via the interactive site but not in this export.</li>
            <li>Stale references (&gt;30 minutes old) are filtered out, so a freshly-restarted league may temporarily show empty events.</li>
          </ul>

          <h2 className="text-2xl font-bold mt-6">Larger datasets</h2>
          <p>
            For full historical archives, per-book price snapshots, or sub-minute updates, contact{" "}
            <a href="mailto:kenny@hyder.me" className="text-emerald-500 hover:underline">kenny@hyder.me</a>. Research-grade access is available for academic / journalistic use cases.
          </p>
        </div>
      </main>
    </div>
  );
}
