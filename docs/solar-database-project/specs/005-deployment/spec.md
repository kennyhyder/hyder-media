# Spec 005: Deployment

## Overview

Deploy the SolarTrack application to Vercel with Supabase backend.

## Feature Requirements

1. **Vercel Deployment**: Deploy Next.js app to Vercel
2. **Environment Variables**: Configure production secrets
3. **Database Migration**: Ensure production database is set up
4. **Domain Setup**: Configure custom domain (optional)
5. **Monitoring**: Set up basic error tracking

## Deployment Steps

### 1. Supabase Production Setup

Already done if using Supabase cloud. Verify:
- [ ] Project created at supabase.com
- [ ] Database schema applied
- [ ] Data imported
- [ ] API keys generated

### 2. Vercel Project Setup

```bash
# Install Vercel CLI if not installed
npm install -g vercel

# Login to Vercel
vercel login

# Initialize project (from project root)
vercel

# Follow prompts:
# - Link to existing project or create new
# - Set project name: solartrack
# - Set framework: Next.js
```

### 3. Environment Variables

Set in Vercel dashboard (Settings > Environment Variables):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```

Or via CLI:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY
```

### 4. Deploy to Production

```bash
# Deploy to production
vercel --prod

# Output will include production URL
```

### 5. Verify Deployment

```bash
# Test production API
curl "https://your-app.vercel.app/api/installations?limit=5"

# Should return JSON with installations
```

### 6. README Documentation

Create comprehensive README.md:

```markdown
# SolarTrack

A comprehensive database of U.S. solar installations, aggregating public data from federal and state sources.

## Features

- **4.5M+ Installations**: Data from Tracking the Sun (LBNL), USPVDB, and state registries
- **Search & Filter**: Find installations by state, installer, size, date, equipment
- **Map Visualization**: See installations on an interactive map
- **API Access**: RESTful API for programmatic queries
- **Export**: Download filtered results as CSV

## Data Sources

| Source | Records | Coverage |
|--------|---------|----------|
| Tracking the Sun (LBNL) | ~4.5M | National, distributed solar |
| USPVDB (USGS) | ~5,700 | Large-scale (≥1 MW) |
| California DGStats | ~2M | California |
| NY-Sun | ~500K | New York |

## API Endpoints

### List Installations
```
GET /api/installations?page=1&limit=50
```

### Search
```
GET /api/installations/search?state=CA&min_size=5&installer=sunrun
```

### Stats
```
GET /api/stats
```

### Export
```
GET /api/export?state=CA&format=csv
```

## Local Development

```bash
# Clone repo
git clone https://github.com/your-repo/solartrack.git
cd solartrack

# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials

# Run development server
npm run dev
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Backend**: Next.js API Routes, Supabase
- **Database**: PostgreSQL with PostGIS
- **Hosting**: Vercel

## Data Updates

Data is sourced from public databases and updated periodically:
- Tracking the Sun: Annual release (typically December)
- USPVDB: Quarterly updates
- State registries: Varies

## License

Data sourced from public government databases. See individual data sources for licensing terms.

## Future Roadmap

- [ ] Real-time monitoring API integrations (Enphase, SolarEdge)
- [ ] Commercial data licenses
- [ ] Permit scraping automation
- [ ] Installer verification system
```

## Acceptance Criteria

- [ ] Vercel project created and linked
- [ ] Environment variables configured
- [ ] Production deployment successful
- [ ] Production URL returns data from API
- [ ] Home page loads correctly
- [ ] Search functionality works in production
- [ ] README.md documents all features and API
- [ ] No console errors in production

## Verification

```bash
# Full verification script
PROD_URL="https://your-app.vercel.app"

# Test home page
curl -I "$PROD_URL"

# Test API
curl "$PROD_URL/api/installations?limit=1"

# Test search
curl "$PROD_URL/api/installations/search?state=CA&limit=1"

# Test stats
curl "$PROD_URL/api/stats"
```

## Completion Signal

Output `<promise>DONE</promise>` when:
1. `vercel --prod` succeeds
2. Production URL is accessible
3. API endpoints return data
4. UI loads without errors
5. README.md is complete

Then output `<promise>PROJECT_COMPLETE</promise>` to signal the entire project is done.
