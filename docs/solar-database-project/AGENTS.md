# AGENTS.md - Project-Specific Commands

> This file defines the exact commands Claude should use for building, testing, and validating this project.

## Build Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Type check
npx tsc --noEmit
```

## Test Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- path/to/test.ts
```

## Lint Commands

```bash
# Run ESLint
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

## Database Commands

```bash
# Generate Supabase types
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts

# Run migrations (if using Supabase CLI)
npx supabase db push

# Reset database (CAUTION)
npx supabase db reset
```

## Data Ingestion Commands

```bash
# Download Tracking the Sun data
curl -o data/tracking-the-sun.csv "https://emp.lbl.gov/sites/default/files/TTS_LBNL_public_file_07-Dec-2024.csv"

# Run ingestion script
npx ts-node scripts/ingest-tracking-the-sun.ts

# Verify import count
npx ts-node scripts/verify-import.ts
```

## Deployment Commands

```bash
# Deploy to Vercel
vercel --prod

# Check deployment status
vercel ls
```

## Validation Checklist

Before outputting `<promise>DONE</promise>` for any spec, verify:

1. **Tests pass**: `npm test` exits with code 0
2. **Types check**: `npx tsc --noEmit` exits with code 0
3. **Lint passes**: `npm run lint` exits with code 0
4. **Build succeeds**: `npm run build` exits with code 0

## Directory Structure

```
solartrack/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── installations/
│   │   │       └── route.ts
│   │   ├── page.tsx
│   │   └── layout.tsx
│   ├── components/
│   │   ├── InstallationTable.tsx
│   │   ├── SearchFilters.tsx
│   │   └── InstallationMap.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts
│   │   │   └── server.ts
│   │   └── utils.ts
│   └── types/
│       ├── database.ts
│       └── installation.ts
├── scripts/
│   ├── ingest-tracking-the-sun.ts
│   ├── ingest-uspvdb.ts
│   └── verify-import.ts
├── data/
│   └── .gitkeep
└── tests/
    ├── api.test.ts
    └── components.test.tsx
```

## Git Workflow

```bash
# After completing each task
git add -A
git commit -m "feat: [description of what was implemented]"

# After completing each spec
git tag -a "spec-XXX-complete" -m "Completed spec XXX"
git push origin main --tags
```

## Error Recovery

If a command fails:
1. Read the error message carefully
2. Check if it's a missing dependency → `npm install`
3. Check if it's a type error → fix the TypeScript
4. Check if it's a test failure → fix the implementation
5. If stuck after 3 attempts, document the issue and move to next task
