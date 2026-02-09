-- RPC function for geospatial "near me" search
-- Used by /api/solar/installations.js when near_lat/near_lng/radius_miles params are provided
-- Returns installations within a given radius, ordered by distance
-- PostgREST filters (.eq, .ilike, .gte, etc.) can be chained on top

CREATE OR REPLACE FUNCTION solar_nearby(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_m DOUBLE PRECISION
)
RETURNS SETOF solar_installations
LANGUAGE sql STABLE
AS $$
  SELECT si.*
  FROM solar_installations si
  WHERE si.location IS NOT NULL
    AND ST_DWithin(
      si.location,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      radius_m
    )
  ORDER BY ST_Distance(
    si.location,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  );
$$;
