# Claude Instructions: Build SolarTrack Autonomously

> **IMPORTANT**: This document contains all instructions needed to build SolarTrack without asking for permissions. Read completely before starting.

## Your Mission

Build **SolarTrack**, a comprehensive U.S. solar installation database using free public data sources. The end product helps solar equipment resellers find installer information and equipment details.

## Authorization

You have full authorization to:
- Create, edit, and delete files
- Run npm/node commands
- Execute database migrations
- Deploy to Vercel
- Make git commits
- Run tests

**Do not ask for permission. Execute autonomously.**

## Project Location

All project files are in: `docs/solar-database-project/`

Read these files in order:
1. `PROJECT_INSTRUCTIONS.md` - Overview and phases
2. `CONSTITUTION.md` - Guiding principles
3. `AGENTS.md` - Commands to use
4. `specs/001-database-schema/spec.md` - First task
5. Continue through specs 002-005

## Execution Protocol

### For Each Spec:

1. **Read** the spec file completely
2. **Create** IMPLEMENTATION_PLAN.md if it doesn't exist
3. **Update** the plan with current task status
4. **Implement** the acceptance criteria
5. **Test** using commands in AGENTS.md
6. **Commit** changes with descriptive message
7. **Output** `<promise>DONE</promise>` when ALL criteria met
8. **Proceed** to next spec

### Implementation Plan Format

Create/update `IMPLEMENTATION_PLAN.md`:

```markdown
# Implementation Plan

## Current Status
- Spec 001: COMPLETE
- Spec 002: IN PROGRESS
- Spec 003: PENDING
- Spec 004: PENDING
- Spec 005: PENDING

## Current Task
Spec 002: Data Ingestion - Creating ingest script

## Completed Tasks
- [x] Created database schema
- [x] Generated TypeScript types
- [x] Verified PostGIS enabled

## Next Steps
- [ ] Download Tracking the Sun CSV
- [ ] Create ingest-tracking-the-sun.ts
- [ ] Run ingestion
- [ ] Verify 100k+ records
```

## Commands Reference

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run tests
npx tsc --noEmit     # Type check

# Database
npx supabase gen types typescript --project-id PROJECT_ID > src/types/database.ts

# Ingestion
npx ts-node scripts/ingest-tracking-the-sun.ts
npx ts-node scripts/verify-import.ts

# Deployment
vercel --prod
```

## Tech Stack (Do Not Deviate)

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL + PostGIS)
- **Validation**: Zod
- **Data Fetching**: React Query
- **Maps**: Leaflet (free, no API key)

## File Structure

```
solartrack/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── installations/
│   │   │   │   ├── route.ts
│   │   │   │   └── search/route.ts
│   │   │   ├── installers/route.ts
│   │   │   ├── stats/route.ts
│   │   │   └── export/route.ts
│   │   ├── page.tsx
│   │   ├── search/page.tsx
│   │   ├── installers/page.tsx
│   │   └── installation/[id]/page.tsx
│   ├── components/
│   │   ├── SearchFilters.tsx
│   │   ├── InstallationTable.tsx
│   │   └── InstallationMap.tsx
│   ├── lib/
│   │   └── supabase/
│   │       ├── client.ts
│   │       └── server.ts
│   └── types/
│       └── installation.ts
├── scripts/
│   ├── ingest-tracking-the-sun.ts
│   └── verify-import.ts
├── data/
│   └── .gitkeep
└── IMPLEMENTATION_PLAN.md
```

## Completion Signals

- After completing each spec: `<promise>DONE</promise>`
- After completing ALL specs: `<promise>PROJECT_COMPLETE</promise>`

## Error Handling

If you encounter an error:
1. Read the error message carefully
2. Attempt to fix (up to 3 tries)
3. If still failing, document in IMPLEMENTATION_PLAN.md under "Blockers"
4. Move to next task if not a hard dependency
5. Return to blocked task later

## Quality Gates

Before outputting `<promise>DONE</promise>`:

- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` passes (if tests exist)
- [ ] `npx tsc --noEmit` has no errors
- [ ] All acceptance criteria in spec are met

## Environment Variables

These should already be set. If not, check `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```

## Git Protocol

After each significant change:

```bash
git add -A
git commit -m "feat(spec-XXX): description of what was done"
```

After completing each spec:

```bash
git tag -a "spec-XXX-complete" -m "Completed spec XXX"
```

## Start Now

1. Read `PROJECT_INSTRUCTIONS.md`
2. Read `CONSTITUTION.md`
3. Read `specs/001-database-schema/spec.md`
4. Create IMPLEMENTATION_PLAN.md
5. Begin implementing Spec 001
6. Continue until `<promise>PROJECT_COMPLETE</promise>`

**Go.**
