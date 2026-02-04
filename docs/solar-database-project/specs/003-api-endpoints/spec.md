# Spec 003: API Endpoints

## Overview

Create REST API endpoints for querying the solar installation database.

## Feature Requirements

1. **List Installations**: Paginated list with default sorting
2. **Search/Filter**: Query by state, installer, date range, size
3. **Get Single Installation**: Retrieve by ID
4. **Get Installer Stats**: Aggregate installer data
5. **Export**: CSV download of filtered results

## Endpoints

### GET /api/installations

List installations with pagination.

**Query Parameters**:
- `page` (number, default: 1)
- `limit` (number, default: 50, max: 100)
- `sort` (string, default: 'install_date')
- `order` ('asc' | 'desc', default: 'desc')

**Response**:
```json
{
  "data": [Installation],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 4500000,
    "totalPages": 90000
  }
}
```

### GET /api/installations/search

Search with filters.

**Query Parameters**:
- `state` (string, 2-letter code)
- `installer` (string, partial match)
- `min_size` (number, kW)
- `max_size` (number, kW)
- `start_date` (string, YYYY-MM-DD)
- `end_date` (string, YYYY-MM-DD)
- `module_manufacturer` (string)
- `inverter_manufacturer` (string)
- `customer_segment` ('residential' | 'commercial' | 'utility')
- `page` (number)
- `limit` (number)

**Response**: Same as /api/installations

### GET /api/installations/[id]

Get single installation by ID.

**Response**:
```json
{
  "data": Installation
}
```

### GET /api/installers

List installers with stats.

**Query Parameters**:
- `state` (string)
- `min_installations` (number)
- `sort` ('installation_count' | 'total_capacity_kw' | 'name')
- `page`, `limit`

**Response**:
```json
{
  "data": [Installer],
  "pagination": {...}
}
```

### GET /api/stats

Aggregate statistics.

**Response**:
```json
{
  "total_installations": 4500000,
  "total_capacity_kw": 50000000,
  "installations_by_state": {
    "CA": 1200000,
    "TX": 500000,
    ...
  },
  "installations_by_year": {
    "2024": 800000,
    "2023": 750000,
    ...
  },
  "top_installers": [
    { "name": "Sunrun", "count": 150000 },
    ...
  ],
  "data_sources": [
    { "name": "tracking_the_sun", "count": 4000000 },
    ...
  ]
}
```

### GET /api/export

Export filtered results as CSV.

**Query Parameters**: Same as /api/installations/search
- `format` ('csv', default)

**Response**: CSV file download

## Implementation

### src/app/api/installations/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  sort: z.string().default('install_date'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const params = querySchema.parse({
    page: searchParams.get('page'),
    limit: searchParams.get('limit'),
    sort: searchParams.get('sort'),
    order: searchParams.get('order'),
  });

  const supabase = await createClient();

  const offset = (params.page - 1) * params.limit;

  const { data, error, count } = await supabase
    .from('installations')
    .select('*', { count: 'exact' })
    .order(params.sort, { ascending: params.order === 'asc' })
    .range(offset, offset + params.limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total: count,
      totalPages: Math.ceil((count || 0) / params.limit),
    },
  });
}
```

### src/app/api/installations/search/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const searchSchema = z.object({
  state: z.string().length(2).optional(),
  installer: z.string().optional(),
  min_size: z.coerce.number().optional(),
  max_size: z.coerce.number().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  module_manufacturer: z.string().optional(),
  inverter_manufacturer: z.string().optional(),
  customer_segment: z.enum(['residential', 'commercial', 'utility']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export async function GET(request: NextRequest) {
  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const params = searchSchema.parse(searchParams);

  const supabase = await createClient();
  const offset = (params.page - 1) * params.limit;

  let query = supabase
    .from('installations')
    .select('*', { count: 'exact' });

  // Apply filters
  if (params.state) {
    query = query.eq('state', params.state.toUpperCase());
  }
  if (params.installer) {
    query = query.ilike('installer_name', `%${params.installer}%`);
  }
  if (params.min_size) {
    query = query.gte('system_size_kw', params.min_size);
  }
  if (params.max_size) {
    query = query.lte('system_size_kw', params.max_size);
  }
  if (params.start_date) {
    query = query.gte('install_date', params.start_date);
  }
  if (params.end_date) {
    query = query.lte('install_date', params.end_date);
  }
  if (params.module_manufacturer) {
    query = query.ilike('module_manufacturer', `%${params.module_manufacturer}%`);
  }
  if (params.inverter_manufacturer) {
    query = query.ilike('inverter_manufacturer', `%${params.inverter_manufacturer}%`);
  }
  if (params.customer_segment) {
    query = query.eq('customer_segment', params.customer_segment);
  }

  const { data, error, count } = await query
    .order('install_date', { ascending: false })
    .range(offset, offset + params.limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total: count,
      totalPages: Math.ceil((count || 0) / params.limit),
    },
  });
}
```

### src/lib/supabase/server.ts

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component
          }
        },
      },
    }
  );
}
```

## Acceptance Criteria

- [ ] GET /api/installations returns paginated results
- [ ] GET /api/installations/search filters work correctly
- [ ] GET /api/installations/[id] returns single installation
- [ ] GET /api/installers returns installer list with stats
- [ ] GET /api/stats returns aggregate statistics
- [ ] GET /api/export returns CSV file
- [ ] All endpoints handle errors gracefully
- [ ] Zod validation on all query parameters
- [ ] Response times < 500ms for list endpoints

## Verification

```bash
# Test list endpoint
curl "http://localhost:3000/api/installations?page=1&limit=10"

# Test search
curl "http://localhost:3000/api/installations/search?state=CA&min_size=5"

# Test stats
curl "http://localhost:3000/api/stats"
```

## Completion Signal

Output `<promise>DONE</promise>` when:
1. All 6 endpoints implemented
2. All endpoints return valid JSON
3. Search filters work correctly
4. Tests pass for each endpoint
