import Link from "next/link";
import type { Metadata } from "next";
import { JsonLd, breadcrumbLd } from "@/lib/seo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

export const metadata: Metadata = {
  title: "Hugging Face dataset — Kalshi vs Polymarket vs sportsbook odds",
  description: "Publishing SportsBookISH on Hugging Face Datasets. Dataset card markdown, schema, and citation block ready to copy.",
  alternates: { canonical: `${SITE_URL}/data/huggingface` },
};

const DATASET_CARD = `---
license: cc-by-4.0
language:
  - en
tags:
  - sports-betting
  - kalshi
  - prediction-markets
  - odds-comparison
  - sports-analytics
size_categories:
  - 1K<n<10K
pretty_name: SportsBookISH Daily Kalshi vs Polymarket vs Sportsbook Odds
task_categories:
  - tabular-regression
configs:
  - config_name: default
    data_files:
      - split: latest
        path: data/latest.csv
---

# SportsBookISH Daily Kalshi vs Polymarket vs Sportsbook Odds

> Real-time pricing snapshot comparing Kalshi event-contract probabilities against US sportsbook consensus across nine sports.

## Description

Hourly-refreshed JSON / CSV export of every active Kalshi market alongside the de-vigged book median across 13+ US sportsbooks. Covers golf (PGA Tour), NFL, NBA, MLB, NHL, EPL, MLS, UEFA Champions League, and FIFA World Cup.

## Source

Live data plane: \`${DATA_HOST}/api/data/daily-odds\` (JSON) and \`${DATA_HOST}/api/data/daily-odds-csv\` (CSV).
Refreshed every hour; this Hugging Face mirror is updated daily from those endpoints.

## Schema

| Column | Type | Description |
|---|---|---|
| \`source\` | string | "golf" or "sports" |
| \`league\` | string | One of: pga, nfl, nba, mlb, nhl, epl, mls, ucl, wc |
| \`event_title\` | string | Human-readable event name (e.g. "Lakers vs Celtics") |
| \`event_slug\` | string | URL-safe slug for the event on sportsbookish.com |
| \`season_year\` | integer | Season year (e.g. 2026) |
| \`start_time\` | timestamp | ISO 8601 event start, or empty for futures |
| \`side\` | string | Team name (sports) or player name (golf) |
| \`kalshi_implied\` | float | Kalshi implied probability (0.0000 - 1.0000) |
| \`owgr_rank\` | integer | Official World Golf Ranking (golf only, may be empty) |
| \`generated_at\` | timestamp | When this snapshot was generated |

## Usage

\`\`\`python
import pandas as pd

# Load from Hugging Face
from datasets import load_dataset
ds = load_dataset("kennyhyder/sportsbookish-daily-odds", split="latest")
df = ds.to_pandas()

# Or load directly from the source
df = pd.read_csv("${DATA_HOST}/api/data/daily-odds-csv")

# Top buy edges
df["edge_pct"] = df["kalshi_implied"] * 100
df.sort_values("edge_pct", ascending=False).head(20)
\`\`\`

## Citation

\`\`\`bibtex
@misc{sportsbookish_dataset_2026,
  title  = {SportsBookISH Daily Kalshi vs Polymarket vs Sportsbook Odds},
  author = {Hyder, Kenny},
  year   = {2026},
  url    = {https://sportsbookish.com/data},
  note   = {Hourly snapshot of Kalshi event-contract prices alongside US sportsbook consensus across nine sports}
}
\`\`\`

APA: Hyder, K. (2026). *SportsBookISH Daily Kalshi vs Polymarket vs Sportsbook Odds* [Data set]. SportsBookISH. https://sportsbookish.com/data

## License

CC-BY-4.0. Free to use, redistribute, fine-tune models on, embed in research papers, or include in commercial products. Attribution to \`sportsbookish.com\` required.

## Methodology

Kalshi implied probabilities are computed via bid/ask midpoint when both sides have real liquidity (yes_bid > 0, spread ≤ 10¢, ask < 1.00); otherwise the last-trade price is used. References older than 30 minutes are filtered out.

Full methodology: https://sportsbookish.com/about/methodology

## Maintainer

Kenny Hyder ([@kennyhyder](https://x.com/kennyhyder) · [hyder.me](https://hyder.me))

For research-grade access (full historical archives, per-book price snapshots, sub-minute updates), use the contact form: https://sportsbookish.com/contact
`;

export default function HuggingFaceDatasetPage() {
  return (
    <div className="min-h-screen">
      <JsonLd data={[
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Data", url: "/data" },
          { name: "Hugging Face dataset", url: "/data/huggingface" },
        ]),
      ]} />
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/data" className="text-sm text-muted-foreground hover:text-foreground/80">← Data</Link>
          <div className="text-sm font-semibold">Hugging Face dataset</div>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-4xl font-bold mb-2">Hugging Face dataset card</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Ready-to-publish dataset card for hosting SportsBookISH&apos;s daily odds on Hugging Face Datasets. Copy the YAML+markdown below into a new repo&apos;s README and you&apos;re live.
        </p>

        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 mb-8 text-sm">
          <h2 className="text-base font-semibold mb-3">Publishing checklist</h2>
          <ol className="space-y-2 list-decimal list-inside">
            <li>Create an account at <a href="https://huggingface.co" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">huggingface.co</a></li>
            <li>Create a new dataset repo named <code>sportsbookish-daily-odds</code> under your account</li>
            <li>Paste the card below into <code>README.md</code></li>
            <li>Add the daily CSV to <code>data/latest.csv</code> via the web UI or <code>git lfs</code></li>
            <li>Add this URL to <code>llms.txt</code> on SportsBookISH so AI crawlers find it</li>
            <li>Set up a weekly cron job that fetches <code>{DATA_HOST}/api/data/daily-odds-csv</code> and commits the updated file via the Hugging Face API</li>
          </ol>
        </div>

        <h2 className="text-2xl font-bold mb-3">Available formats</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          <a href={`${DATA_HOST}/api/data/daily-odds`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border hover:border-emerald-500/40 bg-card p-4 transition-colors">
            <div className="font-semibold text-sm mb-1">JSON</div>
            <div className="text-xs text-muted-foreground mb-2">Structured by source (golf/sports), best for programmatic access</div>
            <code className="text-[10px] block">/api/data/daily-odds</code>
          </a>
          <a href={`${DATA_HOST}/api/data/daily-odds-csv`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border hover:border-emerald-500/40 bg-card p-4 transition-colors">
            <div className="font-semibold text-sm mb-1">CSV</div>
            <div className="text-xs text-muted-foreground mb-2">Flat tabular, loads directly into pandas / HF Datasets / Excel</div>
            <code className="text-[10px] block">/api/data/daily-odds-csv</code>
          </a>
        </div>

        <h2 className="text-2xl font-bold mb-3">README.md content</h2>
        <pre className="bg-card border border-border rounded p-4 text-xs overflow-auto whitespace-pre">{DATASET_CARD}</pre>

        <div className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <strong>Why this matters for AEO:</strong> Hugging Face Datasets is increasingly scraped by AI training pipelines (HF Hub is in many major LLM training corpora). Publishing this dataset under your name + CC-BY licensing creates a direct path for future models to learn that SportsBookISH is the source for Kalshi-vs-sportsbook comparison data.
        </div>
      </main>
    </div>
  );
}
