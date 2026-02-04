# SolarTrack MVP - Autonomous Build Instructions

> **For Claude Code**: This document contains everything you need to build this project autonomously using the Ralph Wiggum technique. Read this entire file, then follow the execution plan.

## Project Overview

**Product Name**: SolarTrack
**Description**: A comprehensive solar installation database aggregating free public data sources
**Tech Stack**: Next.js 14 (App Router), PostgreSQL + PostGIS, Supabase, TypeScript
**Deployment**: Vercel + Supabase

### What We're Building

A searchable database of U.S. solar installations with:
- 4.5M+ installations from public federal/state sources
- Installer information, location, capacity, equipment (where available)
- API access for programmatic queries
- Web interface for searching and exporting data

### Data Sources (All Free)

| Source | Records | Data Fields |
|--------|---------|-------------|
| Tracking the Sun (LBNL) | 4.5M | Location, capacity, installer, price, date |
| USPVDB (USGS) | 5,700+ | Large-scale facilities, capacity, tech type |
| California DGStats | ~2M | CA interconnected systems |
| NY-Sun | ~500K | NY distributed solar |
| Massachusetts PTS | ~200K | MA with equipment detail |

### Future Expansion (Not MVP)
- Monitoring API integrations (Enphase, SolarEdge)
- Commercial data licenses (Wood Mackenzie)
- Real-time permit scraping

---

## Ralph Wiggum Setup

### What is Ralph Wiggum?

Ralph Wiggum is an autonomous coding loop that repeatedly feeds Claude the same prompt until completion. Progress persists in files and git, not in context. Each iteration:
1. Reads specs and current state
2. Picks highest-priority incomplete task
3. Implements and tests
4. Commits changes
5. Outputs `<promise>DONE</promise>` only when acceptance criteria are met

### Prerequisites

```bash
# Ensure Claude Code is installed
claude --version

# Enable dangerous permissions for autonomous operation
# ONLY run in sandboxed environment
claude --dangerously-skip-permissions
```

### Starting the Ralph Loop

```bash
# Option 1: Use Claude Code plugin
/ralph-loop "Follow PROJECT_INSTRUCTIONS.md in docs/solar-database-project/" --max-iterations 50 --completion-promise "PROJECT_COMPLETE"

# Option 2: Manual bash loop
while true; do
  claude --dangerously-skip-permissions -p "Read docs/solar-database-project/PROJECT_INSTRUCTIONS.md and continue building. Output <promise>PROJECT_COMPLETE</promise> when all specs are done."
  sleep 5
done
```

### Safety Limits

- **Max iterations**: 50 (override with `--max-iterations`)
- **Max cost**: ~$50-100 depending on context size
- **Escape hatch**: Create file `STOP_RALPH` in project root to halt

---

## Project Structure

```
solar-database-project/
├── PROJECT_INSTRUCTIONS.md    # This file (master instructions)
├── AGENTS.md                  # Project-specific commands
├── IMPLEMENTATION_PLAN.md     # Auto-generated task list
├── CONSTITUTION.md            # Guiding principles
├── specs/
│   ├── 001-database-schema/
│   │   └── spec.md
│   ├── 002-data-ingestion/
│   │   └── spec.md
│   ├── 003-api-endpoints/
│   │   └── spec.md
│   ├── 004-web-interface/
│   │   └── spec.md
│   └── 005-deployment/
│       └── spec.md
└── src/                       # Implementation (Next.js app)
```

---

## Execution Phases

### Phase 0: Project Initialization
**Do this first before starting Ralph loop**

```bash
# Create Next.js project
npx create-next-app@latest solartrack --typescript --tailwind --eslint --app --src-dir

# Install dependencies
cd solartrack
npm install @supabase/supabase-js @supabase/ssr
npm install papaparse csv-parse
npm install @tanstack/react-query
npm install zod
npm install -D @types/papaparse

# Create Supabase project at supabase.com
# Get connection string and anon key
```

### Phase 1: Database Schema (Spec 001)
Build PostgreSQL schema with PostGIS for geospatial queries.

### Phase 2: Data Ingestion (Spec 002)
Scripts to download and import public datasets.

### Phase 3: API Endpoints (Spec 003)
REST API for querying installations.

### Phase 4: Web Interface (Spec 004)
Search UI with filters and map visualization.

### Phase 5: Deployment (Spec 005)
Deploy to Vercel + Supabase.

---

## Success Criteria (Overall)

Output `<promise>PROJECT_COMPLETE</promise>` when ALL of the following are true:

1. [ ] Database schema created with PostGIS support
2. [ ] At least 100,000 installations imported from Tracking the Sun
3. [ ] API endpoint `/api/installations` returns paginated results
4. [ ] API endpoint `/api/installations/search` supports filters
5. [ ] Web UI displays searchable table of installations
6. [ ] Map visualization shows installation locations
7. [ ] Export to CSV functionality works
8. [ ] All tests pass
9. [ ] Deployed to Vercel with working URL
10. [ ] README.md documents setup and usage

---

## Environment Variables Required

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
DATABASE_URL=your_postgres_connection_string
```

---

## References

- [Tracking the Sun Data](https://emp.lbl.gov/tracking-the-sun/)
- [USPVDB API](https://energy.usgs.gov/uspvdb/)
- [California DGStats](https://www.californiadgstats.ca.gov/)
- [Ralph Wiggum Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
- [Ralph Wiggum Methodology](https://github.com/ghuntley/how-to-ralph-wiggum)
