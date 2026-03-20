"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}

interface GeoSearchProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any; // Leaflet map instance
  onLocationSelect: (lat: number, lng: number, radius: number, displayName: string) => void;
  siteCount: number;
}

const RADIUS_OPTIONS = [10, 25, 50, 100];

export default function GeoSearch({ map, onLocationSelect, siteCount }: GeoSearchProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [radius, setRadius] = useState(25);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circleRef = useRef<any>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update circle when radius changes
  useEffect(() => {
    if (selectedCoords && map) {
      drawCircle(selectedCoords.lat, selectedCoords.lng, radius);
      onLocationSelect(selectedCoords.lat, selectedCoords.lng, radius, selectedLocation || "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  const drawCircle = useCallback(async (lat: number, lng: number, radiusMiles: number) => {
    if (!map) return;
    const L = await import("leaflet");

    // Remove existing circle
    if (circleRef.current) {
      map.removeLayer(circleRef.current);
    }

    // Draw radius circle
    const radiusMeters = radiusMiles * 1609.34;
    circleRef.current = L.circle([lat, lng], {
      radius: radiusMeters,
      color: "#7c3aed",
      fillColor: "#7c3aed",
      fillOpacity: 0.08,
      weight: 2,
      dashArray: "6 4",
    }).addTo(map);
  }, [map]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    // Rate limit: 1 request per second
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchRef.current;
    if (timeSinceLastFetch < 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastFetch));
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=us&limit=5`,
        {
          headers: { "User-Agent": "GridScout/1.0" },
        }
      );
      if (!res.ok) return;
      const data: NominatimResult[] = await res.json();
      lastFetchRef.current = Date.now();
      setSuggestions(data);
      setShowDropdown(data.length > 0);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setSelectedLocation(null);
    setSelectedCoords(null);

    // Remove circle when clearing
    if (!value && circleRef.current && map) {
      map.removeLayer(circleRef.current);
      circleRef.current = null;
    }

    // Debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 500);
  };

  const handleSelect = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    // Simplify display name: take first 2-3 parts
    const parts = result.display_name.split(", ");
    const shortName = parts.slice(0, 3).join(", ");

    setQuery(shortName);
    setSelectedLocation(shortName);
    setSelectedCoords({ lat, lng });
    setShowDropdown(false);

    // Center map and zoom
    if (map) {
      map.setView([lat, lng], 10);
    }

    // Draw radius circle
    drawCircle(lat, lng, radius);

    // Notify parent
    onLocationSelect(lat, lng, radius, shortName);
  };

  const handleClear = () => {
    setQuery("");
    setSelectedLocation(null);
    setSelectedCoords(null);
    setSuggestions([]);
    setShowDropdown(false);

    if (circleRef.current && map) {
      map.removeLayer(circleRef.current);
      circleRef.current = null;
    }

    // Reset to national view
    if (map) {
      map.setView([39.0, -98.0], 5);
    }

    onLocationSelect(0, 0, 0, "");
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-3 left-14 z-[1100]"
      style={{ width: "360px" }}
    >
      <div className="bg-white rounded-lg shadow-lg border border-gray-200">
        {/* Search input */}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            placeholder="Search location (city, state, address...)"
            className="w-full pl-9 pr-8 py-2.5 text-sm rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-purple-500"
            onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          />
          {(query || selectedLocation) && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {isLoading && (
            <div className="absolute right-8 top-1/2 -translate-y-1/2">
              <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>

        {/* Dropdown suggestions */}
        {showDropdown && suggestions.length > 0 && (
          <div className="border-t border-gray-100 max-h-60 overflow-y-auto">
            {suggestions.map((result) => (
              <button
                key={result.place_id}
                onClick={() => handleSelect(result)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0"
              >
                <div className="truncate">{result.display_name}</div>
              </button>
            ))}
          </div>
        )}

        {/* Radius selector + count (shown when location selected) */}
        {selectedLocation && (
          <div className="border-t border-gray-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Radius:</span>
              <div className="flex gap-1">
                {RADIUS_OPTIONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setRadius(r)}
                    className={`px-2 py-0.5 text-xs rounded-full font-medium transition-colors ${
                      radius === r
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {r}mi
                  </button>
                ))}
              </div>
            </div>
            <div className="text-xs text-purple-700 font-medium mt-1.5">
              {siteCount.toLocaleString()} site{siteCount !== 1 ? "s" : ""} within {radius}mi of {selectedLocation}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
