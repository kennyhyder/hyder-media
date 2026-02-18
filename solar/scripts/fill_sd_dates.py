#!/usr/bin/env python3
"""Fill install_date for SD City records from source CSV files.
Uses APPROVAL_ID (PMT-xxx) to match source_record_id (sdcity_PMT-xxx).
Prefers DATE_PROJECT_COMPLETE, falls back to DATE_APPROVAL_ISSUE."""
import csv, json, urllib.request, urllib.parse, os
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv(Path(__file__).parent.parent / '.env.local')
SUPABASE_URL = (os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')).strip()
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY').strip()

SAFE_CHARS = '.*,()'

def supabase_patch(table, filters, data):
    params = '&'.join(
        k + '=' + urllib.parse.quote(str(v), safe=SAFE_CHARS)
        for k, v in filters.items()
    )
    url = SUPABASE_URL + '/rest/v1/' + table + '?' + params
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method='PATCH')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True
    except Exception as e:
        return False

# Read all SD City CSVs and extract dates using APPROVAL_ID
data_dir = Path(__file__).parent.parent / 'data' / 'san_diego_csv'
date_map = {}  # sdcity_PMT-xxx -> date

for fname in ['set2_active.csv', 'set2_closed.csv']:
    fpath = data_dir / fname
    if not fpath.exists():
        print(f'  Skipping {fname} (not found)')
        continue
    count_this_file = 0
    with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            approval_id = row.get('APPROVAL_ID', '').strip()
            if not approval_id:
                continue
            # Prefer DATE_PROJECT_COMPLETE, fallback to DATE_APPROVAL_ISSUE, then DATE_APPROVAL_CREATE
            date_str = (
                row.get('DATE_PROJECT_COMPLETE', '').strip()
                or row.get('DATE_APPROVAL_ISSUE', '').strip()
                or row.get('DATE_APPROVAL_CREATE', '').strip()
            )
            if date_str and len(date_str) >= 10:
                date_map['sdcity_' + approval_id] = date_str[:10]  # YYYY-MM-DD
                count_this_file += 1
    print(f'  {fname}: extracted {count_this_file} dates ({len(date_map)} total)')

print(f'Total SD City records with dates: {len(date_map)}')

# Quick test: verify one record matches
test_key = next(iter(date_map))
test_date = date_map[test_key]
print(f'Test record: {test_key} -> {test_date}')

# Verify the source_record_id exists in DB
test_url = SUPABASE_URL + '/rest/v1/solar_installations?source_record_id=eq.' + urllib.parse.quote(test_key) + '&select=source_record_id,install_date&limit=1'
headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
}
req = urllib.request.Request(test_url, headers=headers)
with urllib.request.urlopen(req, timeout=30) as resp:
    result = json.loads(resp.read())
    print(f'DB lookup: {result}')

# Batch patch via ThreadPoolExecutor
patched = 0
errors = 0
total = len(date_map)

def do_patch(src_id, date):
    return supabase_patch(
        'solar_installations',
        {'source_record_id': 'eq.' + src_id, 'install_date': 'is.null'},
        {'install_date': date}
    )

with ThreadPoolExecutor(max_workers=20) as executor:
    futures = {executor.submit(do_patch, sid, d): sid for sid, d in date_map.items()}
    for i, future in enumerate(as_completed(futures)):
        if future.result():
            patched += 1
        else:
            errors += 1
        if (i + 1) % 5000 == 0:
            print(f'  Progress: {i+1}/{total} (patched={patched}, errors={errors})')

print(f'SD City install_date fill complete: {patched} patched, {errors} errors out of {total} total')
