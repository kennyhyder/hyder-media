# Auto Glass 2020 Financial Dashboard

## Project Overview

Financial performance dashboard for Auto Glass 2020, displaying historical data from January 2020 through January 2026.

**URL:** https://hyder.me/clients/ag2020
**Password:** AG2020FLOW
**Auth Key:** `ag2020_dashboard_auth`

## Technology Stack

- **Framework:** Next.js 14.1.0 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Build:** Static export (`output: 'export'`)
- **Authentication:** sessionStorage-based password protection

## Directory Structure

```
/clients/ag2020/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main dashboard component (all 7 tabs)
│   │   ├── layout.tsx        # App layout with metadata
│   │   └── globals.css       # Global styles
│   └── lib/
│       ├── data.ts           # Business metrics, forecasts, historical data exports
│       └── bankTransactions.ts # Bank transaction data for cash infusion tracking
├── data/
│   ├── complete-historical-data.json  # Merged performance + ad spend data
│   ├── historical-performance.json    # Processed CSV data (margins + sales)
│   └── google-ads-spend.json         # Ad spend from Google Ads API
├── scripts/
│   ├── post-build.js                 # Injects auth, moves build output
│   ├── process-historical-data.js    # Processes CSV files into JSON
│   └── merge-historical-data.js      # Merges performance + ad spend
├── public/
│   ├── password.html                 # Password protection gate
│   └── logo.webp                     # Auto Glass 2020 logo
├── next.config.js                    # Static export config with basePath
├── tailwind.config.js                # Tailwind configuration
└── package.json                      # Dependencies and scripts
```

## Dashboard Tabs (7)

| Tab | ID | Description |
|-----|----|-------------|
| Dashboard | `#dashboard` | Business metrics overview with KPIs |
| Overhead | `#overhead` | Monthly fixed overhead itemization |
| Payroll | `#payroll` | Weekly payroll breakdown by employee |
| Debt | `#debt` | Outstanding debt with interest rates |
| Forecast | `#forecast` | Interactive job-driven financial forecast |
| Performance | `#performance` | **Historical performance with year selector** |
| Bank Statements | `#bank-statements` | Transaction viewer with cash infusion marking |

## Data Pipeline

### Source Data

1. **Margin Report CSV:** `ag2020-margins-jan2020_jan2026.csv`
   - Invoice numbers, dates, revenue, margin, costs
   - ~54,000+ job records

2. **Sales Report CSV:** `ag2020-sales-jan2020_jan2026.csv`
   - Invoice numbers, dates (for matching)
   - Payer/insurance company breakdown

3. **Google Ads API:** Two accounts
   - Current: `505-336-5860` (via MCC `673-698-8718`)
   - Historical: `439-961-4856` (direct access)

### Processing Scripts

```bash
# Step 1: Process CSV files into historical-performance.json
node scripts/process-historical-data.js

# Step 2: Fetch Google Ads spend (requires API connection)
# Uses /api/google-ads/ag2020-spend endpoint

# Step 3: Merge performance + ad spend
node scripts/merge-historical-data.js
```

### Data Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  Margin CSV     │     │  Sales CSV      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │ process-historical- │
         │ data.js             │
         └──────────┬──────────┘
                    ▼
         ┌─────────────────────┐
         │ historical-         │
         │ performance.json    │
         └──────────┬──────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌────────┐   ┌─────────────┐   ┌────────────┐
│ Google │   │ merge-      │   │ Google Ads │
│ Ads    │──▶│ historical- │◀──│ API        │
│ Spend  │   │ data.js     │   │ /ag2020-   │
│ .json  │   └──────┬──────┘   │ spend      │
└────────┘          ▼          └────────────┘
            ┌─────────────────┐
            │ complete-       │
            │ historical-     │
            │ data.json       │
            └────────┬────────┘
                     ▼
            ┌─────────────────┐
            │ src/lib/data.ts │
            │ (imports JSON)  │
            └────────┬────────┘
                     ▼
            ┌─────────────────┐
            │ page.tsx        │
            │ (Performance    │
            │  tab display)   │
            └─────────────────┘
```

## Historical Data Summary

As of 2026-02-05:

| Metric | Value |
|--------|-------|
| Date Range | Jan 2020 - Jan 2026 |
| Total Months | 73 |
| Total Jobs | 54,752 |
| Total Revenue | $39,129,507 |
| Total Margin | $20,029,589 |
| Total Ad Spend | $1,312,549 |
| Total Net Margin | $18,717,040 |

### Yearly Breakdown

| Year | Jobs | Revenue | Margin | Ad Spend | Net Margin | ROAS |
|------|------|---------|--------|----------|------------|------|
| 2020 | 4,837 | $3.5M | $1.7M | $10K | $1.7M | 355x |
| 2021 | 7,512 | $4.6M | $2.2M | $41K | $2.1M | 113x |
| 2022 | 10,203 | $6.5M | $3.2M | $236K | $3.0M | 28x |
| 2023 | 11,298 | $7.9M | $4.0M | $346K | $3.6M | 23x |
| 2024 | 12,104 | $9.7M | $5.0M | $454K | $4.6M | 21x |
| 2025 | 7,786 | $5.9M | $3.4M | $205K | $3.2M | 29x |
| 2026* | 1,012 | $946K | $534K | $20K | $514K | 47x |

*2026 is partial (January only)

## Build & Deploy

### Local Development

```bash
cd /Users/kennyhyder/Desktop/hyder-media/clients/ag2020
npm install
npm run dev
# Visit http://localhost:3000/clients/ag2020
```

### Production Build

```bash
npm run build
# Output goes to parent directory (handled by post-build.js)
# Files: index.html, password.html, _next/, etc.
```

### Deployment

Deploy via git push (auto-deploys from GitHub):

```bash
git add .
git commit -m "Update AG2020 dashboard"
git push origin main
```

## Configuration Files

### next.config.js

```javascript
const nextConfig = {
  output: 'export',
  basePath: '/clients/ag2020',
  assetPrefix: '/clients/ag2020/',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
}
```

### tsconfig.json

Includes path alias `@/*` → `./src/*` for imports.

## Authentication Flow

1. User visits `/clients/ag2020/` → index.html loads
2. `<script>` in `<head>` checks `sessionStorage.getItem('ag2020_dashboard_auth')`
3. If not authenticated → redirect to `password.html`
4. User enters "AG2020FLOW" → sets sessionStorage → redirect to index.html
5. Dashboard loads normally

## Google Ads API Integration

### Endpoint

`POST /api/google-ads/ag2020-spend`

### Accounts Configuration

```javascript
const accounts = [
  { id: '5053365860', mcc: '6736988718' },  // Current account (via MCC)
  { id: '4399614856', mcc: '4399614856' }   // Historical account (direct)
];
```

### API Details

- API Version: v23
- Endpoint: `:search` (not `:searchStream`)
- Query: `SELECT campaign.name, segments.month, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date >= '2019-01-01'`

## Key Files Reference

### Main Dashboard Component

`src/app/page.tsx` - 1000+ lines containing:
- Tab navigation with hash-based routing
- Performance tab with year selector
- Forecast calculator with growth projections
- Bank statements with cash infusion tracking

### Data Types

`src/lib/data.ts` - Contains:
- `HistoricalMonthData` - Monthly performance metrics
- `HistoricalYearData` - Yearly aggregations
- `CompleteHistoricalData` - Full data structure
- Helper functions: `getYearMonthlyData()`, `getYearSummary()`, `getAvailableYears()`

### Historical Data JSON

`data/complete-historical-data.json` - Structure:

```json
{
  "generated": "2026-02-05T01:16:08.370Z",
  "summary": {
    "totalMonths": 73,
    "dateRange": { "start": "2020-01", "end": "2026-01" },
    "totalJobs": 54752,
    "totalRevenue": 39129507,
    "totalMargin": 20029589,
    "totalAdSpend": 1312549,
    "totalNetMargin": 18717040
  },
  "yearly": [/* HistoricalYearData[] */],
  "monthly": [/* HistoricalMonthData[] */],
  "dataSources": {
    "performance": "CSV files",
    "adSpend": "Google Ads API"
  }
}
```

## Troubleshooting

### Build fails with type error

If `historicalData` type assertion fails:
```typescript
// Use double assertion through unknown
export const historicalData: CompleteHistoricalData =
  historicalDataJson as unknown as CompleteHistoricalData;
```

### Google Ads API 501 UNIMPLEMENTED

- Check API version (should be v23, not v18)
- Use `:search` endpoint, not `:searchStream`
- Verify MCC vs direct account access

### Missing ad spend data

1. Run the API endpoint to fetch fresh data
2. Save to `data/google-ads-spend.json`
3. Run `node scripts/merge-historical-data.js`
4. Rebuild: `npm run build`

### Performance tab shows wrong year

- Check `selectedYear` state initialization (defaults to 2025)
- Verify `getAvailableYears()` returns correct years from data

## Migration History

**Original Location:** `~/Desktop/auto-glass-cash-flow/`
**Migrated To:** `/Users/kennyhyder/Desktop/hyder-media/clients/ag2020/`
**Date:** 2026-02-04

Changes during migration:
- Added static export configuration
- Added password protection (AG2020FLOW)
- Added basePath `/clients/ag2020`
- Created data processing pipeline
- Integrated Google Ads API for historical spend
- Replaced 2025-only performance tab with full historical view

## Related Documentation

- Main hyder-media CLAUDE.md: `/Users/kennyhyder/Desktop/hyder-media/CLAUDE.md`
- Google Ads API docs: `/api/google-ads/` endpoints
- Original deployment: Still active at `kennyhyder/auto-glass-cash-flow` repo


<claude-mem-context>
# Recent Activity

### Feb 5, 2026

| ID | Time | T | Title | Read |
|----|------|---|-------|------|
| #28 | 11:15 AM | 🔵 | Client portal architecture revealed with three password-protected dashboards and authentication gaps | ~1168 |
</claude-mem-context>