#!/usr/bin/env python3
"""
Populate DC tax incentive data into grid_county_data.
Source: Manual compilation from state economic development agencies.
Target: grid_county_data table (updates existing rows by state)

37 states + DC have some form of datacenter tax incentive as of 2025.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

# State-level DC incentive data (37 states + DC with incentives as of 2025)
# Sources: state economic development agencies, CBRE DC Tax Incentive Guide 2024
DC_INCENTIVES = {
    'AL': {'type': 'sales_tax_exemption', 'details': 'Sales & use tax abatement on qualifying equipment. $400M+ investment threshold.'},
    'AZ': {'type': 'property_tax_reduction', 'details': 'Government Property Lease Excise Tax (GPLET) for qualified facilities on government land.'},
    'CO': {'type': 'sales_tax_exemption', 'details': 'Enterprise Zone sales tax exemptions; broadband equipment tax credit.'},
    'CT': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on computer & data processing equipment.'},
    'FL': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on manufacturing machinery including servers; no state income tax.'},
    'GA': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on data processing equipment; investment tax credits for $150M+ projects.'},
    'HI': {'type': 'tax_credits', 'details': 'Enterprise Zone tax credits; limited applicability.'},
    'IA': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment for $1M+ investments; property tax phase-in for new construction.'},
    'ID': {'type': 'property_tax_exemption', 'details': 'Personal property tax exemption on computer equipment.'},
    'IL': {'type': 'sales_tax_exemption', 'details': 'Enterprise Zone sales tax exemption; High Impact Business designation for $12M+ DC investments.'},
    'IN': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment for $750M+/$400M+ investments; EDGE credits up to 100% of payroll taxes.'},
    'KS': {'type': 'property_tax_exemption', 'details': 'PEAK program payroll tax incentives; IRB property tax exemptions available.'},
    'KY': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on electricity for large industrial users; KBI tax credits.'},
    'LA': {'type': 'sales_tax_exemption', 'details': 'Industrial Tax Exemption Program (ITEP) up to 80% property tax abatement for 10 years.'},
    'MD': {'type': 'property_tax_credits', 'details': 'Enterprise Zone property tax credits; personal property tax credits on DC equipment.'},
    'MI': {'type': 'property_tax_exemption', 'details': 'Personal property tax exemption for eligible DC equipment; MEGA tax credits.'},
    'MN': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment and electricity for qualified DCs.'},
    'MO': {'type': 'sales_tax_exemption', 'details': 'Qualified data center sales tax exemption (2019 law); state income tax credits.'},
    'MS': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment for $50M+ investments; fee-in-lieu of property tax.'},
    'MT': {'type': 'property_tax_abatement', 'details': 'New/expanding industry tax abatement available for DC construction.'},
    'NC': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment and electricity for $75M+ investments; property tax abatement.'},
    'ND': {'type': 'property_tax_exemption', 'details': 'Property tax exemption for new DC construction for up to 5 years.'},
    'NE': {'type': 'sales_tax_exemption', 'details': 'ImagiNE Nebraska Act: sales tax exemption on DC equipment; investment tax credits.'},
    'NJ': {'type': 'sales_tax_exemption', 'details': 'UEZ sales tax exemption (reduced rate); BEIP/Grow NJ incentives for job creation.'},
    'NV': {'type': 'sales_tax_abatement', 'details': 'Partial abatement of sales/use tax and personal property tax for $25M+ DC investments.'},
    'NY': {'type': 'sales_tax_exemption', 'details': 'Excelsior Jobs Program tax credits; IDA property tax abatements (PILOT); Empire State Digital Gaming.'},
    'OH': {'type': 'sales_tax_exemption', 'details': 'DC sales tax exemption on equipment and electricity (2022 law); JobsOhio grants.'},
    'OK': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment; 5-year ad valorem tax exemption.'},
    'OR': {'type': 'property_tax_exemption', 'details': 'Enterprise Zone property tax exemption for 3-15 years; no sales tax in Oregon.'},
    'PA': {'type': 'sales_tax_exemption', 'details': 'Keystone Opportunity Zone/KOEZ sales and property tax exemptions in designated areas.'},
    'SC': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment; fee-in-lieu of property tax for $50M+ investments.'},
    'SD': {'type': 'no_income_tax', 'details': 'No state corporate income tax; no personal income tax; no personal property tax.'},
    'TN': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment for $250M+ investments; no state income tax on wages.'},
    'TX': {'type': 'sales_tax_exemption', 'details': 'Chapter 313/Chapter 403 property tax abatements; Texas Enterprise Fund; no state income tax.'},
    'UT': {'type': 'sales_tax_exemption', 'details': 'Enterprise Zone tax credits; Economic Development Tax Increment Financing (EDTIF).'},
    'VA': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment for $150M+ investments (2025: $100M+); MEGA site program.'},
    'WA': {'type': 'sales_tax_exemption', 'details': 'Sales tax exemption on DC equipment and construction for eligible facilities; no state income tax.'},
    'WI': {'type': 'sales_tax_exemption', 'details': 'Enterprise Zone tax credits; TIF available for DC construction in eligible areas.'},
    'WY': {'type': 'no_income_tax', 'details': 'No state corporate or personal income tax; low property taxes.'},
    'DC': {'type': 'tax_credits', 'details': 'Technology sector tax incentives; Qualified High Technology Company (QHTC) credits.'},
}


def supabase_request(method, path, data=None, headers_extra=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    }
    if headers_extra:
        headers.update(headers_extra)
    body = json.dumps(data, allow_nan=False).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ''
            if e.code in (500, 502, 503) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise


def main():
    print("=" * 60)
    print("GridScout DC Tax Incentive Data")
    print("=" * 60)

    dry_run = '--dry-run' in sys.argv
    print(f"  {len(DC_INCENTIVES)} states with DC tax incentives")

    if dry_run:
        for state, info in sorted(DC_INCENTIVES.items()):
            print(f"  {state}: {info['type']} — {info['details'][:60]}...")
        return

    # Update all counties in states with incentives
    patched = 0
    errors = 0

    for state, info in DC_INCENTIVES.items():
        try:
            import urllib.parse
            state_encoded = urllib.parse.quote(state)
            supabase_request(
                'PATCH',
                f'grid_county_data?state=eq.{state_encoded}',
                {
                    'has_dc_tax_incentive': True,
                    'dc_incentive_type': info['type'],
                    'dc_incentive_details': info['details'],
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                }
            )
            patched += 1
        except Exception as e:
            errors += 1
            print(f"  Error patching {state}: {e}")

    # Update data source
    ds = supabase_request('GET', 'grid_data_sources?name=eq.dc_tax_incentives&select=id')
    if ds:
        supabase_request('PATCH', f'grid_data_sources?id=eq.{ds[0]["id"]}', {
            'record_count': len(DC_INCENTIVES),
            'last_import': datetime.now(timezone.utc).isoformat()
        })

    print(f"\n{'=' * 60}")
    print(f"DC Tax Incentives Complete")
    print(f"  States patched: {patched}")
    print(f"  Errors: {errors}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
