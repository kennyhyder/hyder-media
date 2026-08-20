-- Synthesize env_constraint_score (0-100, higher = more environmentally constrained)
-- from the already-computed environmental flags, so the environmental layer becomes
-- a scored, rankable dimension surfaced on site pages (parity-plus vs. brownfield-DD
-- tools that only flag risk without scoring it). Applied 2026-08-19.
update grid_dc_sites set env_constraint_score = least(100,
    (case when superfund_nearby then 30 else 0 end) +
    (case when flood_zone_sfha then 25 else 0 end) +
    (case when critical_habitat then 25 else 0 end) +
    (case when coalesce((environmental_flags->'wetland'->>'present')::boolean, false) then 15 else 0 end) +
    (case when env_wetland_pct > 25 then 10 else 0 end)
);
