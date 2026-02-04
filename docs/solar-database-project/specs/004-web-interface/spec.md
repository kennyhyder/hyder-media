# Spec 004: Web Interface

## Overview

Create a web interface for searching and visualizing solar installation data.

## Feature Requirements

1. **Search Form**: Filter installations by multiple criteria
2. **Results Table**: Paginated, sortable data table
3. **Map View**: Visualize installations on a map
4. **Installer Directory**: Browse installers with stats
5. **Export Button**: Download filtered results as CSV
6. **Responsive Design**: Works on mobile and desktop

## Pages

### Home Page (/)

Dashboard with:
- Quick stats (total installations, total capacity, etc.)
- Search form
- Recent installations table
- Top installers

### Search Page (/search)

Full search interface with:
- Filter sidebar
- Results table
- Map toggle
- Export button

### Installer Page (/installers)

Installer directory with:
- Searchable list
- Stats per installer
- Link to installer's installations

### Installation Detail (/installation/[id])

Single installation view with:
- All available fields
- Map location
- Link to installer

## Components

### src/components/SearchFilters.tsx

```typescript
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

const CUSTOMER_SEGMENTS = ['residential', 'commercial', 'utility'];

interface SearchFiltersProps {
  onSearch: (filters: Record<string, string>) => void;
}

export function SearchFilters({ onSearch }: SearchFiltersProps) {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState({
    state: searchParams.get('state') || '',
    installer: searchParams.get('installer') || '',
    min_size: searchParams.get('min_size') || '',
    max_size: searchParams.get('max_size') || '',
    start_date: searchParams.get('start_date') || '',
    end_date: searchParams.get('end_date') || '',
    module_manufacturer: searchParams.get('module_manufacturer') || '',
    inverter_manufacturer: searchParams.get('inverter_manufacturer') || '',
    customer_segment: searchParams.get('customer_segment') || '',
  });

  const handleChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nonEmpty = Object.fromEntries(
      Object.entries(filters).filter(([_, v]) => v !== '')
    );
    onSearch(nonEmpty);
  };

  const handleClear = () => {
    setFilters({
      state: '',
      installer: '',
      min_size: '',
      max_size: '',
      start_date: '',
      end_date: '',
      module_manufacturer: '',
      inverter_manufacturer: '',
      customer_segment: '',
    });
    onSearch({});
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-gray-50 rounded-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* State */}
        <div>
          <label className="block text-sm font-medium text-gray-700">State</label>
          <select
            value={filters.state}
            onChange={(e) => handleChange('state', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="">All States</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Installer */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Installer</label>
          <input
            type="text"
            value={filters.installer}
            onChange={(e) => handleChange('installer', e.target.value)}
            placeholder="Search installer name..."
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        {/* System Size */}
        <div>
          <label className="block text-sm font-medium text-gray-700">System Size (kW)</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={filters.min_size}
              onChange={(e) => handleChange('min_size', e.target.value)}
              placeholder="Min"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
            <input
              type="number"
              value={filters.max_size}
              onChange={(e) => handleChange('max_size', e.target.value)}
              placeholder="Max"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        {/* Date Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Install Date</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => handleChange('start_date', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => handleChange('end_date', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        {/* Module Manufacturer */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Module Manufacturer</label>
          <input
            type="text"
            value={filters.module_manufacturer}
            onChange={(e) => handleChange('module_manufacturer', e.target.value)}
            placeholder="e.g., LG, SunPower..."
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        {/* Customer Segment */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Customer Type</label>
          <select
            value={filters.customer_segment}
            onChange={(e) => handleChange('customer_segment', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="">All Types</option>
            {CUSTOMER_SEGMENTS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Search
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
        >
          Clear
        </button>
      </div>
    </form>
  );
}
```

### src/components/InstallationTable.tsx

```typescript
'use client';

import { Installation } from '@/types/installation';
import Link from 'next/link';

interface InstallationTableProps {
  installations: Installation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
}

export function InstallationTable({
  installations,
  pagination,
  onPageChange,
}: InstallationTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size (kW)</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Installer</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Equipment</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {installations.map((inst) => (
            <tr key={inst.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 whitespace-nowrap">
                <Link href={`/installation/${inst.id}`} className="text-blue-600 hover:underline">
                  {inst.city ? `${inst.city}, ` : ''}{inst.state}
                </Link>
                {inst.zip_code && <span className="text-gray-400 ml-1">{inst.zip_code}</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {inst.system_size_kw?.toFixed(2) || '-'}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {inst.installer_name || '-'}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                {inst.install_date || '-'}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                {inst.module_manufacturer || '-'}
                {inst.inverter_manufacturer && ` / ${inst.inverter_manufacturer}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-t">
        <div className="text-sm text-gray-500">
          Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
          {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
          {pagination.total.toLocaleString()} results
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1">
            Page {pagination.page} of {pagination.totalPages.toLocaleString()}
          </span>
          <button
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
```

### src/components/InstallationMap.tsx

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { Installation } from '@/types/installation';

// Using Leaflet for map (free, no API key required)
// npm install leaflet react-leaflet @types/leaflet

interface InstallationMapProps {
  installations: Installation[];
  center?: [number, number];
  zoom?: number;
}

export function InstallationMap({
  installations,
  center = [39.8283, -98.5795], // Center of US
  zoom = 4,
}: InstallationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Dynamic import to avoid SSR issues
    import('leaflet').then((L) => {
      if (!mapRef.current) return;

      // Check if map already initialized
      if ((mapRef.current as any)._leaflet_id) return;

      const map = L.map(mapRef.current).setView(center, zoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      // Add markers for installations with coordinates
      installations
        .filter(i => i.latitude && i.longitude)
        .slice(0, 1000) // Limit markers for performance
        .forEach(inst => {
          L.circleMarker([inst.latitude!, inst.longitude!], {
            radius: 3,
            fillColor: '#2563eb',
            color: '#1e40af',
            weight: 1,
            opacity: 0.8,
            fillOpacity: 0.6,
          })
            .bindPopup(`
              <strong>${inst.system_size_kw?.toFixed(2) || '?'} kW</strong><br/>
              ${inst.city || ''} ${inst.state}<br/>
              ${inst.installer_name || 'Unknown installer'}
            `)
            .addTo(map);
        });

      return () => {
        map.remove();
      };
    });
  }, [installations, center, zoom]);

  return (
    <div
      ref={mapRef}
      className="w-full h-[400px] rounded-lg border"
      style={{ zIndex: 0 }}
    />
  );
}
```

## Acceptance Criteria

- [ ] Home page displays stats and recent installations
- [ ] Search form filters work correctly
- [ ] Results table shows paginated data
- [ ] Pagination controls work
- [ ] Map displays installation locations
- [ ] Export button downloads CSV
- [ ] Responsive layout works on mobile
- [ ] Loading states shown during data fetch
- [ ] Error states handled gracefully

## Verification

```bash
# Start dev server
npm run dev

# Test in browser:
# - Navigate to http://localhost:3000
# - Search for installations in CA
# - View map
# - Click through pagination
# - Export results
```

## Completion Signal

Output `<promise>DONE</promise>` when:
1. All pages render without errors
2. Search and filter work
3. Table pagination works
4. Map displays markers
5. Export downloads CSV file
