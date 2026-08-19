-- Transmission lines have no lat/lng (geometry lives in geometry_wkt text; the
-- PostGIS geom column is empty), so the /map data endpoint couldn't viewport-
-- filter them — it returned the top-2000 lines by voltage NATIONWIDE and any
-- single view showed almost none of the 94,619 lines (looked very sparse).
-- Add precomputed WKT centroids + a bbox index so map-data can filter lines to
-- the current viewport, exactly like grid_fiber_routes already does. 2026-08-19.
alter table grid_transmission_lines
  add column if not exists centroid_lat double precision,
  add column if not exists centroid_lng double precision;

update grid_transmission_lines
set centroid_lat = st_y(st_centroid(st_geomfromtext(geometry_wkt, 4326))),
    centroid_lng = st_x(st_centroid(st_geomfromtext(geometry_wkt, 4326)))
where geometry_wkt is not null and centroid_lat is null;

create index if not exists idx_grid_lines_centroid
  on grid_transmission_lines (centroid_lat, centroid_lng);
