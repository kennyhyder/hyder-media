-- Add estimated capacity and capacity band columns to transmission lines.
-- Uses industry-standard voltage-to-MVA heuristics (SIL / thermal limits).
-- These are conservative estimates — actual capacity depends on conductor size,
-- line length, temperature rating, and system conditions.

ALTER TABLE grid_transmission_lines
ADD COLUMN IF NOT EXISTS estimated_capacity_mva NUMERIC(10,1),
ADD COLUMN IF NOT EXISTS capacity_band TEXT;

-- Populate from voltage using industry-standard heuristics:
--   765 kV → ~2000 MVA (typical SIL ~2200 MW, thermal limit higher)
--   500 kV → ~900 MVA  (typical SIL ~900 MW)
--   345 kV → ~400 MVA  (typical SIL ~400 MW)
--   230 kV → ~200 MVA  (typical SIL ~130 MW, thermal ~350 MVA)
--   138 kV → ~100 MVA  (common distribution-transmission boundary)
--   115 kV → ~80 MVA   (sub-transmission)
--   69 kV  → ~35 MVA   (distribution-level)
--   <69 kV → ~15 MVA   (local distribution)
UPDATE grid_transmission_lines SET
  estimated_capacity_mva = CASE
    WHEN voltage_kv >= 765 THEN 2000
    WHEN voltage_kv >= 500 THEN 900
    WHEN voltage_kv >= 345 THEN 400
    WHEN voltage_kv >= 230 THEN 200
    WHEN voltage_kv >= 138 THEN 100
    WHEN voltage_kv >= 115 THEN 80
    WHEN voltage_kv >= 69 THEN 35
    ELSE 15
  END,
  capacity_band = CASE
    WHEN voltage_kv >= 500 THEN 'extra_high'
    WHEN voltage_kv >= 230 THEN 'high'
    WHEN voltage_kv >= 115 THEN 'medium'
    ELSE 'low'
  END
WHERE voltage_kv IS NOT NULL AND voltage_kv > 0;
