# Ralph Wiggum Setup Guide

> Complete instructions for running SolarTrack as an autonomous build using the Ralph Wiggum technique.

## What is Ralph Wiggum?

Ralph Wiggum is an autonomous coding loop that repeatedly feeds Claude the same prompt until task completion. Named after the Simpsons character, it embodies persistent iteration.

**Key concept**: Progress persists in files and git, not in Claude's context. Each iteration:
1. Reads specs and current state
2. Picks highest-priority incomplete task
3. Implements and tests
4. Commits changes
5. Outputs completion signal only when done

## Prerequisites

### 1. Claude Code CLI

```bash
# Install Claude Code
npm install -g @anthropic/claude-code

# Verify installation
claude --version
```

### 2. Environment Setup

```bash
# Create project directory
mkdir solartrack && cd solartrack

# Copy project instructions
cp -r /path/to/solar-database-project/* .

# Create Next.js app
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir

# Install dependencies
npm install @supabase/supabase-js @supabase/ssr papaparse csv-parse @tanstack/react-query zod leaflet react-leaflet
npm install -D @types/papaparse @types/leaflet
```

### 3. Supabase Setup

1. Create account at [supabase.com](https://supabase.com)
2. Create new project
3. Enable PostGIS extension (Database > Extensions > postgis)
4. Copy credentials:
   - Project URL
   - Anon Key
   - Service Key

### 4. Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
DATABASE_URL=postgresql://...
```

## Running Ralph Wiggum

### Option 1: Claude Code Plugin (Recommended)

```bash
# Start Claude Code
claude

# Run Ralph loop
/ralph-loop "Read PROJECT_INSTRUCTIONS.md and build SolarTrack. Follow specs in order. Output <promise>PROJECT_COMPLETE</promise> when all specs are done." --max-iterations 50 --completion-promise "PROJECT_COMPLETE"
```

### Option 2: Manual Bash Loop

Create `ralph.sh`:

```bash
#!/bin/bash

PROMPT="Read PROJECT_INSTRUCTIONS.md and continue building SolarTrack. Follow specs in order. Check IMPLEMENTATION_PLAN.md for current task. Output <promise>PROJECT_COMPLETE</promise> when all specs are done."

MAX_ITERATIONS=50
ITERATION=0

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    echo "=== Iteration $ITERATION ==="

    # Check for stop file
    if [ -f "STOP_RALPH" ]; then
        echo "Stop file found. Exiting."
        break
    fi

    # Run Claude
    OUTPUT=$(claude --dangerously-skip-permissions -p "$PROMPT" 2>&1)

    echo "$OUTPUT"

    # Check for completion
    if echo "$OUTPUT" | grep -q "PROJECT_COMPLETE"; then
        echo "=== Project Complete! ==="
        break
    fi

    ITERATION=$((ITERATION + 1))
    sleep 5
done

echo "Ralph loop finished after $ITERATION iterations"
```

Run it:
```bash
chmod +x ralph.sh
./ralph.sh
```

### Option 3: Using ralph-orchestrator

```bash
# Install orchestrator
npm install -g ralph-orchestrator

# Run with config
ralph-orchestrator --prompt "PROJECT_INSTRUCTIONS.md" --max-iterations 50
```

## Safety Mechanisms

### 1. Iteration Limit

Always set `--max-iterations`. Recommended:
- Simple tasks: 10-20
- Medium complexity: 30-50
- Large projects: 50-100

### 2. Stop File

Create `STOP_RALPH` in project root to halt immediately:
```bash
touch STOP_RALPH
```

### 3. Cost Monitoring

Estimated costs:
- Per iteration: $0.50-$2.00 (depends on context size)
- Full project: $25-$100

Monitor usage at [console.anthropic.com](https://console.anthropic.com)

### 4. Git Checkpoints

Ralph commits after each task. To rollback:
```bash
git log --oneline
git reset --hard <commit-hash>
```

## Monitoring Progress

### Watch Implementation Plan

```bash
# In separate terminal
watch -n 5 cat IMPLEMENTATION_PLAN.md
```

### Check Git History

```bash
git log --oneline -20
```

### View Current Task

```bash
grep -A 5 "IN PROGRESS" IMPLEMENTATION_PLAN.md
```

## Troubleshooting

### Ralph Gets Stuck

1. Check error in latest output
2. Manually fix blocking issue
3. Update IMPLEMENTATION_PLAN.md to mark task complete
4. Restart Ralph

### Permission Errors

Ensure running with `--dangerously-skip-permissions`:
```bash
claude --dangerously-skip-permissions
```

**Warning**: Only use in sandboxed environments!

### Context Too Large

If hitting token limits:
1. Split large specs into smaller ones
2. Remove completed specs from active context
3. Use subagents for heavy reads

### Database Connection Issues

Verify environment variables:
```bash
echo $NEXT_PUBLIC_SUPABASE_URL
npx supabase db ping
```

## Best Practices

### 1. Clear Completion Criteria

Each spec has explicit acceptance criteria. Don't mark done until ALL criteria met.

### 2. Incremental Commits

Commit after each logical unit of work, not just at spec completion.

### 3. Test Before Proceeding

Run tests after each implementation:
```bash
npm test
npm run build
```

### 4. Document Blockers

If stuck, create `BLOCKERS.md`:
```markdown
# Current Blockers

## Spec 002: Data Ingestion
- Issue: CSV file too large for memory
- Attempted: Streaming parser
- Need: Chunk-based processing
```

## Resources

- [Original Ralph Wiggum Article](https://ghuntley.com/ralph/)
- [Claude Code Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
- [Ralph Orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- [SpecKit Methodology](https://github.com/fstandhartinger/ralph-wiggum)
- [Paddo's Ralph Guide](https://paddo.dev/blog/ralph-wiggum-autonomous-loops/)

## Expected Timeline

With Ralph Wiggum running autonomously:

| Phase | Iterations | Time | Cost |
|-------|------------|------|------|
| Spec 001: Database | 3-5 | 15-30 min | $2-5 |
| Spec 002: Ingestion | 5-10 | 30-60 min | $5-10 |
| Spec 003: API | 5-8 | 25-40 min | $5-8 |
| Spec 004: UI | 8-15 | 40-90 min | $8-15 |
| Spec 005: Deploy | 3-5 | 15-30 min | $2-5 |
| **Total** | **24-43** | **2-4 hours** | **$22-43** |

Your mileage may vary based on model, context size, and complexity.
