# SolarTrack — Web Interface (Next.js + Tailwind)

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## Web Interface (Next.js + Tailwind) - BUILT

All 5 pages built and deployed as static export:

| Page | Route | File | Features |
|------|-------|------|----------|
| Dashboard | `/solar/` | `src/app/page.tsx` | Stats cards, state bar chart, site type breakdown, tech list, data sources |
| Search | `/solar/search/` | `src/app/search/page.tsx` | 12 filters (text/state/type/size/date/installer/owner + geospatial near-me), sortable table, Leaflet map toggle, CSV export, pagination, URL param support |
| Equipment | `/solar/equipment/` | `src/app/equipment/page.tsx` | 6 filters (manufacturer/model/type/state/age), sortable table, pagination, URL param deep-linking |
| Site Detail | `/solar/site/?id=X` | `src/app/site/page.tsx` | Full details, Leaflet map, equipment table with manufacturer links, events timeline, owner/installer cross-links |
| Installers | `/solar/installers/` | `src/app/installers/page.tsx` | Search by name/state, sort by count/capacity/recent, card layout with portfolio stats |

### Key Components
- **InstallationMap** (`src/components/InstallationMap.tsx`) - Leaflet map with ESRI World Imagery satellite tiles (default) + OpenStreetMap street view toggle. Circle markers color-coded by site type (utility=blue, commercial=green, community=purple), size by capacity, popup with details, fits bounds to markers, limited to 1000 markers for performance
- **Dynamic imports**: Map uses `next/dynamic` with `ssr: false` since Leaflet requires `window`
- **URL param support**: Search, Equipment pages read `useSearchParams()` for deep-linking from Site Detail
- **Geospatial search**: "Use Location" button gets browser geolocation, radius picker (10-200 mi), shows distance column + auto-opens map

### Build Process
```bash
cd /Users/kennyhyder/Desktop/hyder-media/solar
npm install
npm run build   # next build + post-build auth injection + move to solar/
```

Build generates static HTML at: `solar/index.html`, `solar/search/index.html`, etc.
Post-build injects sessionStorage auth check and copies `password.html`.

### Build Gotchas
- **Turbopack workspace warning**: Harmless - detects parent `package-lock.json`. Add `turbopack.root` to config to silence.
- **lightningcss native module**: If build fails with "Cannot find lightningcss.darwin-arm64.node", delete `node_modules` and `npm install` fresh
- **Leaflet TypeScript**: Map component uses `any` types for Leaflet map instance (dynamic import doesn't type well)

