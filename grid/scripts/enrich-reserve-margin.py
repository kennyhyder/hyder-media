#!/usr/bin/env python3
"""
Compute regional reserve margins from EIA generation + demand data.

Reserve margin = (installed_capacity - peak_demand) / peak_demand * 100
High reserve margin = more available capacity for new loads.

Uses EIA-860 (capacity) + EIA-861 (demand) data at the balancing authority level.

Approach:
1. Download EIA-860 generator data (installed capacity by BA/state)
2. Download EIA-861 demand data (peak demand by utility/BA)
3. Aggregate to ISO/BA region level
4. Compute reserve margin per region
5. Map DC sites to their ISO/BA region
6. Store reserve_margin_pct on grid_dc_sites

Reserve margin scoring:
- >25% = comfortable surplus (score 100)
- 15-25% = adequate (score 80)
- 10-15% = tight (score 60)
- 5-10% = at risk (score 40)
- <5% = critically low (score 20)

Data sources:
- EIA-860: https://www.eia.gov/electricity/data/eia860/
- EIA-861: https://www.eia.gov/electricity/data/eia861/
- NERC LTRA: https://www.nerc.com/pa/RAPA/ra/Pages/default.aspx

Status: STUB — documents approach for future implementation.
The required data files (EIA-860 generators + EIA-861 demand) need to be
downloaded and parsed. This is a multi-hour implementation task.

For now, ISO-level reserve margins can be approximated from NERC's
Long-Term Reliability Assessment (LTRA) which publishes annual
reserve margins by assessment area.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

# NERC 2024 LTRA reference reserve margins (%)
# Source: https://www.nerc.com/pa/RAPA/ra/Pages/default.aspx
NERC_RESERVE_MARGINS = {
    # ISO/RTO regions
    "CAISO": 22.4,
    "ERCOT": 16.0,
    "ISO-NE": 14.8,
    "MISO": 18.2,
    "NYISO": 17.5,
    "PJM": 19.8,
    "SPP": 24.1,
    # Non-ISO regions (NERC assessment areas)
    "SERC": 21.3,
    "WECC": 19.6,
    "MRO": 20.1,
    "NPCC": 16.2,
    "RF": 18.5,
}


def reserve_margin_score(margin_pct):
    """Convert reserve margin % to 0-100 score."""
    if margin_pct is None:
        return 50
    if margin_pct > 25:
        return 100
    elif margin_pct > 15:
        return 80
    elif margin_pct > 10:
        return 60
    elif margin_pct > 5:
        return 40
    else:
        return 20


def main():
    print("=== GridScout Reserve Margin Enrichment ===")
    print("Status: STUB — using NERC LTRA reference data")
    print()

    for region, margin in sorted(NERC_RESERVE_MARGINS.items(), key=lambda x: -x[1]):
        score = reserve_margin_score(margin)
        print(f"  {region:8s}: {margin:5.1f}% reserve margin → score {score}")

    print()
    print("To implement full EIA-based reserve margins:")
    print("  1. Download EIA-860 generator data (capacity by BA)")
    print("  2. Download EIA-861 demand data (peak demand by utility)")
    print("  3. Aggregate to ISO/BA region level")
    print("  4. Compute reserve_margin = (capacity - peak) / peak * 100")
    print("  5. Map DC sites via iso_region field")
    print("  6. Update grid_dc_sites with reserve_margin_pct")


if __name__ == "__main__":
    main()
