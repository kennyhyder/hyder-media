# SolarTrack Constitution

> Guiding principles for building SolarTrack. Read this before starting any work.

## Mission

Build a comprehensive, accessible database of U.S. solar installations that helps equipment resellers, installers, researchers, and analysts understand the solar market.

## Core Principles

### 1. Data Quality Over Quantity

- Prefer 500,000 accurate records over 5,000,000 incomplete ones
- Always validate data before import
- Track data provenance (source, import date)
- Document known limitations

### 2. API-First Design

- Every feature should be accessible via API
- Document all endpoints thoroughly
- Use consistent response formats
- Include pagination on all list endpoints

### 3. Privacy Compliance

- Never store or expose homeowner PII
- Addresses are okay (public records)
- System details are okay (equipment, size)
- When in doubt, anonymize

### 4. Simplicity

- Use standard tools (Next.js, Supabase, Tailwind)
- Avoid over-engineering
- One way to do things, not three
- Comments only where logic is non-obvious

### 5. Extensibility

- Design schema for future data sources
- Use consistent field naming
- Plan for monitoring API integrations
- Keep import scripts modular

## Technical Standards

### Code Style

- TypeScript strict mode
- Zod for runtime validation
- Async/await over callbacks
- Named exports over default

### Database

- Use UUIDs for primary keys
- Include created_at/updated_at on all tables
- Use PostGIS for geospatial queries
- Index frequently queried columns

### API

- RESTful conventions
- JSON responses
- Consistent error format: `{ error: string }`
- Pagination: `{ data: [], pagination: { page, limit, total, totalPages } }`

### Testing

- Test API endpoints
- Test data mapping functions
- Don't test trivial getters/setters
- Aim for 70%+ coverage on critical paths

## Future Considerations

When building, keep in mind these planned expansions:

1. **Monitoring APIs**: Enphase, SolarEdge, AlsoEnergy integrations
2. **Commercial Data**: Wood Mackenzie, Ohm Analytics licensing
3. **Permit Scraping**: Automated county permit data collection
4. **User Accounts**: API keys, saved searches, alerts

Design with these in mind, but don't build them in MVP.

## Decision Framework

When faced with a choice:

1. **Will it help Blue Water Battery find equipment sources?** → Do it
2. **Is it required for MVP?** → Do it now
3. **Is it nice-to-have?** → Document for later
4. **Does it add complexity without clear value?** → Skip it
