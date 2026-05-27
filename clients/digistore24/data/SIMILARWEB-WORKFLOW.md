# SimilarWeb → Hyder Media Keyword Tool Workflow

End-to-end pipeline for ingesting SimilarWeb competitor keyword exports into the competitive intel dashboard. Documented for re-use across clients (Digistore24, PageWheel, AutomateDojo) and to capture institutional knowledge.

## When to use this

- A client wants competitive keyword intelligence
- We don't have API access to SimilarWeb (Kenny's current tier is UI-export only — see `~/.claude/projects/-Users-kennyhyder-Desktop-hyder-media/memory/competitor-keyword-data-apis.md` for the API-based alternative path via DataForSEO Labs)
- We've identified 6–15 competitor domains worth tracking

## Step 1 — Identify competitors

Two complementary methods:

1. **Direct competition list**: Domains you know compete head-to-head (e.g., PageWheel competing against ClickFunnels, Leadpages, Kartra, Kajabi, Systeme.io, GoHighLevel).
2. **SERP discovery**: Search the category's flagship keyword on Google (e.g., "page builder", "funnel builder"). Note every advertiser that appears in the paid results — those are demonstrably willing to spend on the category. Add their domains to the list (this is how PageWheel's set expanded from 6 → 12 to include base44, elementor, lovable, shopify, squarespace, wix).

## Step 2 — Pull SimilarWeb exports

For each competitor domain:

1. SimilarWeb → search the competitor's domain
2. **Paid Keywords** report (NOT Organic Keywords)
3. **Country: Worldwide** (or US if Kenny wants strict US-only — current PageWheel pull is Worldwide which inflates counts)
4. **Time range: trailing 12 months** (default — gives stable estimates)
5. **Export → .xlsx** (NOT .csv — the script reads the `Website_Keywords` sheet specifically)
6. Download will be named like `Website Keywords-<domain>-(999)-(YYYY_MM-YYYY_MM).xlsx`

Drop ALL the .xlsx files into:
```
clients/digistore24/data/ppc-kws/
```

The folder is shared across all clients — the import script filters by filename to figure out which client a given file belongs to.

## Step 3 — Configure the import script

For a **new client**, create an import script following the pattern of
`scripts/import-pagewheel-keywords.js`. Key sections to customize:

```js
// 1. Brand filename → clean key map
const BRAND_MAP = {
    'clickfunnels.com': 'clickfunnels',
    // ... add one entry per competitor domain
};

// 2. Category rules — what the keyword text means in *this client's* taxonomy
const CATEGORY_RULES = [
    { pattern: /\b(category-specific-terms)\b/i, category: 'Category Name' },
    // ...
];

// 3. Topic groups — non-brand keyword clustering
const TOPIC_GROUPS = [
    { pattern: /\bfunnel\s*builder\b/i, group: 'funnel builders' },
    // ...
];

// 4. Brand keywords — used to route brand-mentioning keywords to the brand bucket
const BRAND_KEYWORDS = {
    clickfunnels: /clickfunnels?/i,
    // ...
};

// 5. Output path
const OUTPUT_FILE = path.join(__dirname, '../clients/<client>/data/<client>-keywords-combined.json');
```

For an **existing client** (e.g., adding more competitors to PageWheel's 12), just append entries to `BRAND_MAP` and re-run the script — it picks up new files automatically.

## Step 4 — Run the import

```bash
cd /Users/kennyhyder/Desktop/hyder-media
node scripts/import-pagewheel-keywords.js
```

Expected output:
- Lists each ingested .xlsx with the brand it mapped to
- Skipped files (other clients' exports) reported separately
- Total unique keywords before + after filtering
- File size, brand list, global avg CPC, category breakdown

### Built-in filters

The import script automatically drops noise:

- `MIN_CLICKS = 5` — keywords with under 5 estimated annual clicks
- `MIN_CPC = 0.50` — OR commercial intent CPC ≥ $0.50 (keeps high-value low-traffic terms)
- `TOP_N_CAP = 50000` — hard cap to keep the JSON browser-loadable

Without filtering, the raw SimilarWeb dataset for 12 page-builder competitors was 360,758 keywords / 208 MB — way too much for the browser. Filters reduce it to ~50K / 32 MB which mirrors the working Digistore24 dataset.

## Step 5 — Enrich with Google Keyword Planner

The Keyword Planner data adds:
- Real Google avg monthly searches (vs SimilarWeb's estimated clicks)
- Google's low/high top-of-page bid (the real CPC range)
- Competition + competition index

```bash
node scripts/fetch-google-keywords-pagewheel.js
```

The script:
- Reads the keyword JSON from the import step
- Strips synthetic Google estimates if present
- Hits `/api/google-ads/keywords` (POST, JSON body: `{ keywords: [...], exactOnly: true }`)
- **Batch size 15** (Google API caps requests; 100 fails with 400 errors)
- **1.5s delay between batches**
- Computes `average_cpc` as midpoint of low/high bid range
- Recomputes `global_avg_cpc` from real Google data
- Saves updated JSON

For 5K-50K keywords, expect 5-50 minutes of API calls. The script is **incremental** — only fetches keywords that don't have Google data already, so it's safe to interrupt + resume.

## Step 6 — Verify in the dashboard

Visit the keyword tool page for the client (e.g., `https://hyder.me/clients/digistore24/pagewheel-keyword-tool.html`):

- Total keyword count matches the JSON's `total_keywords`
- Brand pills show ALL competitors (count matches `brands` array)
- Filtering by individual brands narrows the result set
- Avg CPC reflects the real Google data (post-enrichment)

## Common gotchas

| Gotcha | Cause | Fix |
|---|---|---|
| File too large to push to git | SimilarWeb dump too broad | Tighten `MIN_CLICKS` / `MIN_CPC` / `TOP_N_CAP` |
| `global_avg_cpc: $0` | Keywords with cpc=null dragging avg to 0 | Compute weighted avg only over `cpc > 0` rows |
| Same keyword across brands shows weird CPC | Naive merge averages disagreeing values | Script uses click-weighted CPC average across brands |
| Dashboard shows old brand names (awin, clickbank...) | Hardcoded references in keyword-tool.html | Sweep all `.brand-<key>` classes + `selectedBrands.includes('<key>')` + DOM IDs (`stat-<key>`) |
| 0 keywords pass filters | Filter checking `brands[]` but keywords have empty `brands[]` | Ensure import attributes brands to every keyword (the script does — verify by checking `keywords[0].brands.length > 0`) |
| iCloud eviction empties data dir | `.icloud` placeholder files instead of real .xlsx | `brctl download <file>` to force iCloud sync, OR `git checkout HEAD -- <file>` if committed |

## Alternative — API-based path (future)

If/when Kenny upgrades to SimilarWeb's API tier OR switches to **DataForSEO Labs** ($0.025/1K calls — see memory note), the manual export step (Step 2) disappears. We replace it with a fetch script that calls `dataforseo_labs/google/ranked_keywords/live` for each domain in `BRAND_MAP`, JSON-merging the result into the same `<client>-keywords-combined.json` schema.

For AutomateDojo specifically, the per-dojo competitive scan is light enough that DataForSEO Labs is essentially free (pennies per dojo). When that build kicks off, see `memory/competitor-keyword-data-apis.md` for the integration plan.
