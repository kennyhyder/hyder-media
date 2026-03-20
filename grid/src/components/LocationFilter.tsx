"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface LocationFilterProps {
  onLocationChange: (lat: number, lng: number, radius: number, label: string) => void;
  onClear: () => void;
}

const RADIUS_OPTIONS = [10, 25, 50, 100];

/**
 * Standalone location search + radius filter for list pages (no Leaflet dependency).
 * Geocodes via Nominatim, then calls parent with (lat, lng, radius) for API filtering.
 */
export default function LocationFilter({ onLocationChange, onClear }: LocationFilterProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(50);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // When radius changes and we have a location, re-notify parent
  useEffect(() => {
    if (selectedCoords && selectedLabel) {
      onLocationChange(selectedCoords.lat, selectedCoords.lng, radius, selectedLabel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const now = Date.now();
    const wait = 1000 - (now - lastFetchRef.current);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    setIsLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=5`,
        { headers: { "User-Agent": "GridScout/1.0" } }
      );
      if (!res.ok) return;
      const data: NominatimResult[] = await res.json();
      lastFetchRef.current = Date.now();
      setSuggestions(data);
      setShowDropdown(data.length > 0);
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 500);
  };

  const handleSelect = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const parts = result.display_name.split(", ");
    const label = parts.slice(0, 3).join(", ");
    setQuery(label);
    setSelectedLabel(label);
    setSelectedCoords({ lat, lng });
    setShowDropdown(false);
    onLocationChange(lat, lng, radius, label);
  };

  const handleClear = () => {
    setQuery("");
    setSelectedLabel(null);
    setSelectedCoords(null);
    setSuggestions([]);
    setShowDropdown(false);
    onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      handleSelect(suggestions[0]);
    }
    if (e.key === "Escape") setShowDropdown(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search by location..."
            className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
            </div>
          )}
          {!isLoading && query && (
            <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {selectedLabel && (
          <div className="flex items-center gap-1">
            {RADIUS_OPTIONS.map(r => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={`px-2 py-1 text-xs rounded-full font-medium transition-colors ${
                  radius === r
                    ? "bg-purple-100 text-purple-700"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {r}mi
              </button>
            ))}
          </div>
        )}
      </div>

      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map(r => {
            const parts = r.display_name.split(", ");
            const primary = parts[0];
            const secondary = parts.slice(1, 4).join(", ");
            return (
              <li key={r.place_id}>
                <button
                  onClick={() => handleSelect(r)}
                  className="w-full text-left px-3 py-2 hover:bg-purple-50 text-sm border-b border-gray-100 last:border-0"
                >
                  <span className="font-medium text-gray-900">{primary}</span>
                  {secondary && <span className="text-gray-500 ml-1 text-xs">{secondary}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedLabel && (
        <div className="mt-1 text-xs text-purple-600 font-medium">
          Showing results within {radius}mi of {selectedLabel}
        </div>
      )}
    </div>
  );
}
