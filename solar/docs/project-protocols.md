# SolarTrack — Specs, Execution Protocol, Env Vars, Git Protocol, Key Decisions

> Extracted verbatim from solar/CLAUDE.md (restructure 2026-07). Master index: solar/CLAUDE.md

## What We're Building

A searchable database focused on **commercial and utility-scale** solar installations with:
- Every commercial (>25 kW) and utility-scale (>1 MW) solar site in the U.S.
- Site owner, developer, and installer for each installation
- Age, size, and precise location of every site
- All equipment used: panels, inverters, racking, batteries with full specs
- Upgrade history, repowers, maintenance events, and site damage records
- Equipment manufacturer and model details for resale/replacement sourcing

### Target User

Blue Water Battery needs this data to:
- Find sites with aging equipment that needs replacement
- Identify equipment models approaching end-of-life
- Source used/refurbished equipment from decommissioned or repowered sites
- Connect with installers and developers for partnership opportunities
- Understand equipment trends and market sizing


## Specs

Read these in order:
1. `specs/001-database-schema/spec.md` - PostgreSQL + PostGIS schema
2. `specs/002-data-ingestion/spec.md` - Download and import scripts
3. `specs/003-api-endpoints/spec.md` - REST API
4. `specs/004-web-interface/spec.md` - Search UI with map
5. `specs/005-deployment/spec.md` - Vercel deployment

## Execution Protocol

### For Each Spec:
1. Read the spec file completely
2. Create/update `IMPLEMENTATION_PLAN.md` with current status
3. Implement all acceptance criteria
4. Test using commands below
5. Commit changes with descriptive message
6. Proceed to next spec

### Commands
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run tests
npx tsc --noEmit     # Type check
```

### Quality Gates (before marking spec complete)
- `npm run build` succeeds
- `npm run lint` passes
- `npx tsc --noEmit` has no errors
- All acceptance criteria in spec are met

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://ilbovwnhrowvxjdkvrln.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-key>
```

## Git Protocol

```bash
# After each significant change
git add <specific-files>
git commit -m "solar: description of what was done"

# Deploy (push to GitHub, Vercel auto-deploys)
git push origin main
```

## Key Decisions

- **Commercial focus**: Filter all data sources to commercial (>=25 kW) and utility (>=1 MW) only
- **Equipment is first-class**: Separate equipment table with full manufacturer/model/specs
- **Event tracking**: Site changes (repowers, upgrades, damage) tracked as events
- **Owner/developer separation**: Different entities can own, develop, and install
- **PostGIS required**: Geospatial queries for "sites within X miles"
- **Use existing Supabase**: Same project as hyder-media (ilbovwnhrowvxjdkvrln.supabase.co)
- **All tables prefixed `solar_`**: Prevents conflicts with other hyder-media tables
- **Idempotent scripts**: All use `source_record_id` UNIQUE + ignore-duplicates for safe reruns
- **CdTe = First Solar**: Safe inference, sole major manufacturer
- **ISO queues**: Best free source for developer/owner names (6 ISOs ingested, 1,199 records total)
- **gridstatus venv**: `.venv` uses Python 3.13 (`/opt/homebrew/bin/python3.13`) because gridstatus requires >=3.10. System Python is 3.9.6.
- **Ohm Analytics**: Best paid option ($30K) for equipment-per-site data

## Decision Framework

When faced with a choice:
1. **Will it help Blue Water Battery find equipment sources?** -> Do it
2. **Is it required for MVP?** -> Do it now
3. **Is it nice-to-have?** -> Document for later
4. **Does it add complexity without clear value?** -> Skip it

