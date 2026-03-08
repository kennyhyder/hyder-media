-- Performance indexes for common GridScout query patterns
-- All use CREATE INDEX IF NOT EXISTS for idempotent reruns

-- grid_dc_sites: filtered by state, site_type, score; sorted by dc_score; geo queries
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_state ON grid_dc_sites (state);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_site_type ON grid_dc_sites (site_type);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_dc_score_desc ON grid_dc_sites (dc_score DESC);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_state_site_type ON grid_dc_sites (state, site_type);
CREATE INDEX IF NOT EXISTS idx_grid_dc_sites_lat_lng ON grid_dc_sites (latitude, longitude);

-- grid_transmission_lines: filtered by voltage, state
CREATE INDEX IF NOT EXISTS idx_grid_transmission_lines_voltage_kv ON grid_transmission_lines (voltage_kv);
CREATE INDEX IF NOT EXISTS idx_grid_transmission_lines_state ON grid_transmission_lines (state);

-- grid_substations: filtered by state
CREATE INDEX IF NOT EXISTS idx_grid_substations_state ON grid_substations (state);

-- grid_brownfield_sites: filtered by state
CREATE INDEX IF NOT EXISTS idx_grid_brownfield_sites_state ON grid_brownfield_sites (state);

-- grid_corridors: filtered by state (via ilike on states column)
CREATE INDEX IF NOT EXISTS idx_grid_corridors_state ON grid_corridors (states);

-- grid_ixp_facilities: filtered by state
CREATE INDEX IF NOT EXISTS idx_grid_ixp_facilities_state ON grid_ixp_facilities (state);
