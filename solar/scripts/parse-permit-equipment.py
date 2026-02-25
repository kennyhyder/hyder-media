#!/usr/bin/env python3
"""
Parse Permit Equipment — Extract equipment data from permit descriptions.

Re-queries municipal permit APIs to get descriptions, then uses NLP/regex
to extract manufacturer, model, wattage, panel count, and inverter info.
Creates solar_equipment records for permits that don't already have them.
Also updates capacity_mw where derivable from panel count × wattage.

Usage:
  python3 -u scripts/parse-permit-equipment.py                    # All cities
  python3 -u scripts/parse-permit-equipment.py --city chicago     # Single city
  python3 -u scripts/parse-permit-equipment.py --city sf,la,chi   # Multiple
  python3 -u scripts/parse-permit-equipment.py --dry-run          # Preview
"""

import os
import sys
import json
import re
import argparse
import urllib.request
import urllib.parse
import urllib.error
import time
from pathlib import Path

from dotenv import load_dotenv

# Load env vars
env_path = Path(__file__).parent.parent / ".env.local"
load_dotenv(env_path)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local")
    sys.exit(1)

BATCH_SIZE = 50
RATE_LIMIT = 1.0

# ---------------------------------------------------------------------------
# Known solar equipment manufacturers
# ---------------------------------------------------------------------------

PANEL_MANUFACTURERS = [
    ("LG", r'\bLG\s*[\-]?\s*(?:Neon|Solar|Mono|Bi)|\bLG\d{3}'),
    ("REC", r'\bREC\s*[\-]?\s*(?:Alpha|TwinPeak|Solar|\d{3})'),
    ("SunPower", r'\bSun\s*Power\b'),
    ("Qcells", r'\b(?:Hanwha|Q\s*Cells?|Qcells?|Q\.PEAK)\b'),
    ("Canadian Solar", r'\bCanadian\s+Solar\b|\bCS\d{1,2}[A-Z]'),
    ("JA Solar", r'\bJA\s+Solar\b|\bJAM\d{2}'),
    ("Trina Solar", r'\bTrina\s+Solar\b|\bTSM[\-\s]'),
    ("LONGi", r'\bLONGi\b|\bLR\d[\-\s]'),
    ("JinkoSolar", r'\bJinko\s*Solar?\b|\bJKM\d{3}'),
    ("Silfab Solar", r'\bSilfab\b|\bSIL[\-\s]?\d{3}'),
    ("First Solar", r'\bFirst\s+Solar\b|\bFS[\-\s]?\d{3}'),
    ("Mission Solar", r'\bMission\s+Solar\b'),
    ("Panasonic", r'\bPanasonic\b|\bVBHN\d{3}'),
    ("Solaria", r'\bSolaria\b'),
    ("Axitec", r'\bAxitec\b'),
    ("Aptos Solar", r'\bAptos\s+Solar\b'),
    ("SolarWorld", r'\bSolarWorld\b|\bSW\s*\d{3}'),
    ("Maxeon Solar", r'\bMaxeon\b'),
    ("Tesla", r'\bTesla\s+Solar\s+(?:Panel|Roof)\b'),
    ("Meyer Burger", r'\bMeyer\s+Burger\b'),
    ("Hyundai Energy", r'\bHyundai\s+(?:Solar|Energy|HiE)\b'),
    ("Risen Energy", r'\bRisen\s+Energy\b'),
    ("Yingli Solar", r'\bYingli\b'),
    ("Astronergy", r'\bAstronergy\b'),
    ("Boviet Solar", r'\bBoviet\b'),
    ("Heliene", r'\bHeliene\b'),
    ("ZNShine Solar", r'\bZNShine\b'),
    ("Phono Solar", r'\bPhono\s+Solar\b'),
    ("Sharp", r'\bSharp\s+(?:Solar|ND|NU)\b'),
]

INVERTER_MANUFACTURERS = [
    ("SolarEdge", r'\bSolarEdge\b|\bSE\d{3,5}[A-Z]'),
    ("Enphase", r'\bEnphase\b|\bIQ\s*\d|\bIQ\d'),
    ("SMA", r'\bSMA\b|\bSunny\s*Boy\b|\bSunny\s*Tripower\b'),
    ("Fronius", r'\bFronius\b|\bPrimo\b|\bSymo\b|\bGalvo\b'),
    ("ABB", r'\bABB\s+(?:inverter|UNO|TRIO)\b'),
    ("Generac", r'\bGenerac\b|\bPWRcell\b'),
    ("Tesla", r'\bTesla\s+(?:Powerwall|Gateway|Inverter|Backup)\b|\bPowerwall\b'),
    ("Schneider Electric", r'\bSchneider\b|\bConext\b|\bXantrex\b'),
    ("Huawei", r'\bHuawei\b|\bSUN2000\b'),
    ("GoodWe", r'\bGoodWe\b'),
    ("Delta Electronics", r'\bDelta\s+(?:M\d|H\d|E\d|Energy|Inverter)\b'),
    ("Chint Power", r'\bChint\b|\bCPS\s+SC\b'),
    ("Sungrow", r'\bSungrow\b'),
    ("AP Systems", r'\bAP\s*Systems\b'),
    ("OutBack Power", r'\bOutBack\b'),
]


# ---------------------------------------------------------------------------
# Equipment extraction
# ---------------------------------------------------------------------------

def extract_manufacturer_model(desc, mfg_list):
    """Extract first matching manufacturer and nearby model number."""
    if not desc:
        return None, None
    for canonical, pattern in mfg_list:
        m = re.search(pattern, desc, re.IGNORECASE)
        if m:
            # Try to find model number near the match
            after = desc[m.end():m.end() + 40]
            model_match = re.match(r'\s*[\-:,]?\s*([A-Z0-9][\w\-\.]{2,20})', after)
            model = model_match.group(1) if model_match else None
            # Also try match text itself for model (e.g., "SE7600H" matched SolarEdge pattern)
            if not model:
                matched_text = m.group(0).strip()
                if re.search(r'\d', matched_text) and len(matched_text) > 3:
                    model = matched_text
            return canonical, model
    return None, None


def parse_equipment_from_description(desc):
    """Full equipment extraction from a permit description."""
    if not desc:
        return None

    equipment = []

    # --- Module extraction ---
    panel_mfg, panel_model = extract_manufacturer_model(desc, PANEL_MANUFACTURERS)

    # Panel count
    panels = None
    for pp in [
        r'\(?\s*(\d+)\s*\)?\s*(?:solar\s+)?(?:panel|module|pv\s+module)s?',
        r'(?:install|mount|add)\w*\s+(\d+)\s+(?:solar\s+)?(?:panel|module)s?',
        r'(?:panel|module)\s*(?:count|qty)[:\s]*(\d+)',
    ]:
        m = re.search(pp, desc, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 50000:
                panels = val
                break

    # Wattage
    watts = None
    for wp in [
        r'(\d{2,4})\s*[Ww](?:att)?\s*(?:panel|module|per|each|dc|solar)?',
        r'(?:panel|module)s?\s+(?:rated?\s+)?(?:at\s+)?(\d{2,4})\s*[Ww]',
    ]:
        m = re.search(wp, desc, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 50 <= val <= 800:
                watts = val
                break

    if panel_mfg or panels or watts:
        eq = {"equipment_type": "module"}
        if panel_mfg:
            eq["manufacturer"] = panel_mfg
        if panel_model:
            eq["model"] = panel_model
        if panels:
            eq["quantity"] = panels
        if watts:
            eq["specs"] = {"watts": watts}
        equipment.append(eq)

    # --- Inverter extraction ---
    inv_mfg, inv_model = extract_manufacturer_model(desc, INVERTER_MANUFACTURERS)

    # SolarEdge model: SE7600H-US, SE10000H-US
    if inv_mfg == "SolarEdge" and not inv_model:
        m = re.search(r'(SE\d{3,5}[A-Z]*[\-]?\w*)', desc, re.IGNORECASE)
        if m:
            inv_model = m.group(1)
    # Enphase model: IQ7PLUS, IQ8+
    if inv_mfg == "Enphase" and not inv_model:
        m = re.search(r'(IQ\s*\d[\w+\-]*)', desc, re.IGNORECASE)
        if m:
            inv_model = m.group(1).replace(" ", "")

    inv_count = None
    m = re.search(r'(\d+)\s*(?:micro[\-\s]?)?inverters?', desc, re.IGNORECASE)
    if m:
        val = int(m.group(1))
        if 1 <= val <= 5000:
            inv_count = val

    inv_kw = None
    m = re.search(r'inverter\s+(?:output|capacity|rated?)?\s*(?:=\s*)?(\d+\.?\d*)\s*kw', desc, re.IGNORECASE)
    if m:
        inv_kw = float(m.group(1))

    if inv_mfg or inv_count or inv_kw:
        eq = {"equipment_type": "inverter"}
        if inv_mfg:
            eq["manufacturer"] = inv_mfg
        if inv_model:
            eq["model"] = inv_model
        if inv_count:
            eq["quantity"] = inv_count
        if inv_kw:
            eq["specs"] = {"capacity_kw": inv_kw}
        equipment.append(eq)

    # --- Battery extraction ---
    for pattern, mfr, model in [
        (r'(?:Tesla\s+)?Powerwall', "Tesla", "Powerwall"),
        (r'(?:Enphase\s+)?Encharge', "Enphase", "Encharge"),
        (r'(?:Generac\s+)?PWRcell', "Generac", "PWRcell"),
        (r'(?:LG\s+)?(?:RESU|Chem)\s*\d', "LG Energy Solution", "RESU"),
        (r'(?:sonnen|ecoLinx|sonnenCore)', "sonnen", None),
        (r'(?:Franklin\s+)?aPower', "Franklin", "aPower"),
    ]:
        if re.search(pattern, desc, re.IGNORECASE):
            eq = {"equipment_type": "battery", "manufacturer": mfr}
            if model:
                eq["model"] = model
            equipment.append(eq)
            break

    return equipment if equipment else None


def parse_capacity_kw(desc):
    """Extract kW capacity from description."""
    if not desc:
        return None
    m = re.search(r'([\d]+\.?\d*)\s*kw', desc, re.IGNORECASE)
    if m:
        val = float(m.group(1))
        if 0.1 <= val <= 100000:
            return val
    m = re.search(r'([\d]+\.?\d*)\s*mw', desc, re.IGNORECASE)
    if m:
        val = float(m.group(1)) * 1000
        if 1 <= val <= 10000000:
            return val
    return None


# ---------------------------------------------------------------------------
# City API configurations
# ---------------------------------------------------------------------------

SOLAR_WHERE = (
    "UPPER({desc}) LIKE '%25SOLAR%25' "
    "OR UPPER({desc}) LIKE '%25PHOTOVOLTAIC%25' "
    "OR UPPER({desc}) LIKE '%25PV SYSTEM%25' "
    "OR UPPER({desc}) LIKE '%25PV MODULE%25'"
)

CITY_CONFIGS = {
    "nola": {
        "name": "New Orleans",
        "prefix": "permit_nola",
        "platform": "socrata",
        "base_url": "https://data.nola.gov/resource/72f9-bi28.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "nyc": {
        "name": "New York City",
        "prefix": "permit_nyc",
        "platform": "socrata",
        "base_url": "https://data.cityofnewyork.us/resource/ipu4-2q9a.json",
        "desc_field": "job_description",
        "id_field": "job__",
        "id_suffix_field": "permit_sequence__",
        "filter": "$where=UPPER(permittee_s_business_name) LIKE '%25SOLAR%25'",
    },
    "austin": {
        "name": "Austin",
        "prefix": "permit_austin",
        "platform": "socrata",
        "base_url": "https://data.austintexas.gov/resource/3syk-w9eu.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "filter": "$where=lower(description) LIKE '%25solar%25' AND permittype='EP'",
    },
    "sacramento": {
        "name": "Sacramento",
        "prefix": "permit_sacramento",
        "platform": "arcgis",
        "base_url": "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/BldgPermitIssued_Archive/FeatureServer/0",
        "desc_field": "Work_Desc",
        "id_field": "Application",
        "arcgis_filter": "upper(Work_Desc) LIKE '%SOLAR%' OR Category='Solar System'",
    },
    "chicago": {
        "name": "Chicago",
        "prefix": "permit_chicago",
        "platform": "socrata",
        "base_url": "https://data.cityofchicago.org/resource/ydr8-5enu.json",
        "desc_field": "work_description",
        "id_field": "id",
        "alt_id_field": ":id",
        "filter": "$where=" + SOLAR_WHERE.format(desc="work_description"),
    },
    "philly": {
        "name": "Philadelphia",
        "prefix": "permit_philly",
        "platform": "carto",
        "base_url": "https://phl.carto.com/api/v2/sql",
        "table_name": "permits",
        "desc_field": "approvedscopeofwork",
        "id_field": "permitnumber",
        "carto_filter": "approvedscopeofwork ILIKE '%solar%' OR typeofwork ILIKE '%solar%'",
    },
    "denver": {
        "name": "Denver",
        "prefix": "permit_denver",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/ePKBjXrBZ2vEEgWd/arcgis/rest/services/Construction_Permits/FeatureServer/0",
        "desc_field": "SolarSystemDescription",
        "alt_desc_field": "Description",
        "id_field": "PermitNum",
        "arcgis_filter": "EstPhotovoltaicCost IS NOT NULL",
    },
    "boston": {
        "name": "Boston",
        "prefix": "permit_boston",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/ga54-wzas.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "sf": {
        "name": "San Francisco",
        "prefix": "permit_sf",
        "platform": "socrata",
        "base_url": "https://data.sfgov.org/resource/i98e-djp9.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "la": {
        "name": "Los Angeles",
        "prefix": "permit_la",
        "platform": "socrata",
        "base_url": "https://data.lacity.org/resource/pi9x-tg5x.json",
        "desc_field": "work_desc",
        "id_field": "permit_nbr",
        "alt_id_field": "permit__",
        "filter": "$where=" + SOLAR_WHERE.format(desc="work_desc"),
    },
    "seattle": {
        "name": "Seattle",
        "prefix": "permit_seattle",
        "platform": "socrata",
        "base_url": "https://data.seattle.gov/resource/76t5-zqzr.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "alt_id_field": "application_permit_number",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "dallas": {
        "name": "Dallas",
        "prefix": "permit_dallas",
        "platform": "socrata",
        "base_url": "https://www.dallasopendata.com/resource/e7gq-4sah.json",
        "desc_field": "work_description",
        "id_field": "permit_number",
        "filter": "$where=" + SOLAR_WHERE.format(desc="work_description"),
    },
    "mesa": {
        "name": "Mesa",
        "prefix": "permit_mesa",
        "platform": "socrata",
        "base_url": "https://data.mesaaz.gov/resource/dzpk-hxfb.json",
        "desc_field": "description_of_work",
        "id_field": "permit_number",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description_of_work"),
    },
    "minneapolis": {
        "name": "Minneapolis",
        "prefix": "permit_minneapolis",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/CCS_Permits/FeatureServer/0",
        "desc_field": "comments",
        "id_field": "permitNumber",
        "arcgis_filter": "upper(comments) LIKE '%SOLAR%'",
    },
    "detroit": {
        "name": "Detroit",
        "prefix": "permit_detroit",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_building_permits/FeatureServer/0",
        "desc_field": "work_description",
        "id_field": "record_id",
        "arcgis_filter": "upper(work_description) LIKE '%SOLAR%'",
    },
    "abq": {
        "name": "Albuquerque",
        "prefix": "permit_abq",
        "platform": "arcgis",
        "base_url": "https://coagisweb.cabq.gov/arcgis/rest/services/public/BuildingPermits_KIVAPOSSE/MapServer/0",
        "oid_paging": True,
        "desc_field": "WorkDescription",
        "id_field": "PermitNumber",
        "arcgis_filter": "upper(WorkDescription) LIKE '%SOLAR%'",
    },
    "slc": {
        "name": "Salt Lake City",
        "prefix": "permit_slc",
        "platform": "socrata",
        "base_url": "https://opendata.utah.gov/resource/nbv6-7v56.json",
        "desc_field": "workdescription",
        "id_field": "permitnum",
        "filter": "$where=upper(workdescription) LIKE '%25SOLAR%25'",
    },
    "sanjose": {
        "name": "San Jose",
        "prefix": "permit_sanjose",
        "platform": "ckan",
        "base_url": "https://data.sanjoseca.gov/api/3/action/datastore_search",
        "resource_id": "761b7ae8-3be1-4ad6-923d-c7af6404a904",
        "desc_field": "WORKDESCRIPTION",
        "alt_desc_field": "workdescription",
        "id_field": "FOLDERNUMBER",
        "alt_id_field": "foldernumber",
    },
    "montco": {
        "name": "Montgomery County",
        "prefix": "permit_montco",
        "platform": "socrata",
        "base_url": "https://data.montgomerycountymd.gov/resource/i26v-w6bd.json",
        "desc_field": "description",
        "id_field": "permitno",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "santarosa": {
        "name": "Santa Rosa",
        "prefix": "permit_santarosa",
        "platform": "socrata",
        "base_url": "https://permits.partner.socrata.com/resource/43a8-pijb.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    # --- New cities added Feb 11, 2026 ---
    "dc": {
        "name": "Washington DC",
        "prefix": "permit_dc",
        "platform": "arcgis_multilayer",
        "base_url": "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer",
        "layers": [25, 24, 37, 9, 8, 2, 3, 14, 15, 16, 17, 18],
        "desc_field": "DESC_OF_WORK",
        "id_field": "PERMIT_ID",
        "arcgis_filter": "UPPER(DESC_OF_WORK) LIKE '%SOLAR%'",
    },
    "miami": {
        "name": "Miami-Dade",
        "prefix": "permit_miami",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/BuildingPermit_gdb/FeatureServer/0",
        "desc_field": "DESC1",
        "id_field": "PROCNUM",
        "arcgis_filter": "UPPER(DESC1) LIKE '%SOLAR%'",
    },
    "norfolk": {
        "name": "Norfolk",
        "prefix": "permit_norfolk",
        "platform": "socrata",
        "base_url": "https://data.norfolk.gov/resource/fahm-yuh4.json",
        "desc_field": "work_type",
        "id_field": "permit_number",
        "filter": "$where=UPPER(work_type) LIKE '%25SOLAR%25'",
    },
    "kc": {
        "name": "Kansas City",
        "prefix": "permit_kc",
        "platform": "socrata",
        "base_url": "https://data.kcmo.org/resource/ntw8-aacc.json",
        "desc_field": "description",
        "id_field": "permitnum",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "orlando": {
        "name": "Orlando",
        "prefix": "permit_orlando",
        "platform": "socrata",
        "base_url": "https://data.cityoforlando.net/resource/ryhf-m453.json",
        "desc_field": "project_name",
        "id_field": "permit_number",
        "filter": "$where=UPPER(project_name) LIKE '%25SOLAR%25'",
    },
    "batonrouge": {
        "name": "Baton Rouge",
        "prefix": "permit_batonrouge",
        "platform": "socrata",
        "base_url": "https://data.brla.gov/resource/7fq7-8j7r.json",
        "desc_field": "projectdescription",
        "id_field": "permitnumber",
        "filter": "$where=UPPER(projectdescription) LIKE '%25SOLAR%25'",
    },
    "durham": {
        "name": "Durham",
        "prefix": "permit_durham",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/G5vR3cOjh6g2Ed8E/arcgis/rest/services/Permits/FeatureServer/13",
        "desc_field": "P_Descript",
        "id_field": "Permit_ID",
        "arcgis_filter": "UPPER(P_Descript) LIKE '%SOLAR%'",
    },
    "raleigh": {
        "name": "Raleigh",
        "prefix": "permit_raleigh",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0",
        "desc_field": "proposedworkdescription",
        "id_field": "permitnum",
        "arcgis_filter": "UPPER(proposedworkdescription) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "ftl": {
        "name": "Fort Lauderdale",
        "prefix": "permit_ftl",
        "platform": "arcgis",
        "base_url": "https://gis.fortlauderdale.gov/server/rest/services/BuildingPermits/MapServer/0",
        "desc_field": "PERMITDESC",
        "id_field": "PERMITID",
        "arcgis_filter": "UPPER(PERMITDESC) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "phoenix": {
        "name": "Phoenix",
        "prefix": "permit_phoenix",
        "platform": "arcgis",
        "base_url": "https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1",
        "desc_field": "PERMIT_NAME",
        "id_field": "PER_NUM",
        "arcgis_filter": "UPPER(PERMIT_NAME) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "maricopa": {
        "name": "Maricopa County",
        "prefix": "permit_maricopa",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/ykpntM6e3tHvzKRJ/arcgis/rest/services/Building_Permits_(view)/FeatureServer/0",
        "desc_field": "PermitDescription",
        "id_field": "PermitNumber",
        "arcgis_filter": "UPPER(PermitDescription) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "sanantonio": {
        "name": "San Antonio",
        "prefix": "permit_sanantonio",
        "platform": "ckan",
        "base_url": "https://data.sanantonio.gov/api/3/action/datastore_search",
        "resource_id": "c22b1ef2-dcf8-4d77-be1a-ee3638092aab",
        "ckan_filters": {"PERMIT TYPE": "Solar - Photovoltaic Permit"},
        "page_size": 1000,
        "desc_field": "PROJECT NAME",
        "id_field": "PERMIT #",
    },

    # =========================================================================
    # Wave 2: Cities from ingest-permits.py not previously in this script
    # =========================================================================

    # --- ArcGIS cities ---
    "portland": {
        "name": "Portland",
        "prefix": "permit_portland",
        "platform": "arcgis",
        "base_url": "https://www.portlandmaps.com/arcgis/rest/services/Public/BDS_Permit/MapServer/4",
        "oid_paging": True,
        "desc_field": "DESCRIPTION",
        "extra_desc_fields": ["WORK_DESCRIPTION"],
        "id_field": "OBJECTID",
        "arcgis_filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR UPPER(DESCRIPTION) LIKE '%PHOTOVOLTAIC%'",
        "out_sr": "4326",
    },
    "la_county": {
        "name": "LA County",
        "prefix": "permit_lacounty",
        "platform": "arcgis",
        "base_url": "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPIC-LA_Case_History_view/FeatureServer/0",
        "desc_field": "DESCRIPTION",
        "id_field": "CASENUMBER",
        "arcgis_filter": "CASENAME = 'Unincorporated Solar'",
        "out_sr": "4326",
    },
    "las_vegas": {
        "name": "Las Vegas",
        "prefix": "permit_lasvegas",
        "platform": "arcgis",
        "base_url": "https://mapdata.lasvegasnevada.gov/clvgis/rest/services/DevelopmentServices/BuildingPermits/MapServer/0",
        "oid_paging": True,
        "desc_field": "DESCRIPTION",
        "extra_desc_fields": ["WORKDESC", "FULL_DESC"],
        "id_field": "PERMIT_NUM",
        "alt_id_field": "PERMNUM",
        "arcgis_filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR UPPER(WORKDESC) LIKE '%SOLAR%' OR UPPER(FULL_DESC) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "baltimore": {
        "name": "Baltimore",
        "prefix": "permit_baltimore",
        "platform": "arcgis",
        "base_url": "https://egisdata.baltimorecity.gov/egis/rest/services/Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3",
        "desc_field": "Description",
        "id_field": "CaseNumber",
        "arcgis_filter": "UPPER(Description) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "charlotte": {
        "name": "Charlotte",
        "prefix": "permit_charlotte",
        "platform": "arcgis",
        "base_url": "https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0",
        "desc_field": "workdesc",
        "extra_desc_fields": ["permitdesc"],
        "id_field": "permitnum",
        "arcgis_filter": "UPPER(workdesc) LIKE '%SOLAR%' OR UPPER(permitdesc) LIKE '%SOLAR%' OR UPPER(workdesc) LIKE '%PHOTOVOLTAIC%' OR UPPER(permitdesc) LIKE '%PHOTOVOLTAIC%'",
        "out_sr": "4326",
    },
    "nashville": {
        "name": "Nashville",
        "prefix": "permit_nashville",
        "platform": "arcgis",
        "base_url": "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Trade_Permits_View/FeatureServer/0",
        "desc_field": "Purpose",
        "id_field": "PermitNumber",
        "arcgis_filter": "UPPER(Permit_Subtype_Description) LIKE '%PHOTOVOLTAIC%'",
        "out_sr": "4326",
    },
    "sacramento_county": {
        "name": "Sacramento County",
        "prefix": "permit_saccounty",
        "platform": "arcgis",
        "base_url": "https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Permits/FeatureServer/0",
        "desc_field": "WorkDescription",
        "id_field": "Application",
        "arcgis_filter": "upper(WorkDescription) LIKE '%SOLAR%' OR Application_Subtype LIKE '%Solar%'",
        "out_sr": "4326",
    },
    "tucson": {
        "name": "Tucson",
        "prefix": "permit_tucson",
        "platform": "arcgis_multilayer",
        "base_url": "https://mapdata.tucsonaz.gov/arcgis/rest/services/PublicMaps/PermitsCode/MapServer",
        "layers": [85, 81],
        "oid_paging": True,
        "desc_field": "DESCRIPTION",
        "id_field": "NUMBER",
        "arcgis_filter": "UPPER(DESCRIPTION) LIKE '%SOLAR%' OR WORKCLASS LIKE '%Solar%'",
        "out_sr": "4326",
    },
    "louisville": {
        "name": "Louisville",
        "prefix": "permit_louisville",
        "platform": "arcgis",
        "base_url": "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/Louisville_Metro_KY_All_Permits_%28Historical%29/FeatureServer/0",
        "desc_field": "WORKTYPE",
        "extra_desc_fields": ["CATEGORYNAME"],
        "id_field": "PERMITNUM",
        "arcgis_filter": "UPPER(WORKTYPE) LIKE '%SOLAR%' OR UPPER(CATEGORYNAME) LIKE '%SOLAR%' OR UPPER(CONTRACTOR) LIKE '%SOLAR%'",
        "out_sr": "4326",
    },
    "riverside": {
        "name": "Riverside",
        "prefix": "permit_riverside",
        "platform": "arcgis",
        "base_url": "https://gis.countyofriverside.us/arcgis_mapping/rest/services/OpenData/General/MapServer/280",
        "oid_paging": True,
        "desc_field": "CASE_DESCR",
        "id_field": "CASE_ID",
        "arcgis_filter": "CASE_WORK_CLASS LIKE 'SLRC%' OR CASE_WORK_CLASS LIKE 'DA03%' OR CASE_WORK_CLASS LIKE 'FCN59%' OR CASE_WORK_CLASS LIKE 'GSLRR%'",
        "out_sr": "4326",
    },

    # --- CKAN cities ---
    "virginia_beach": {
        "name": "Virginia Beach",
        "prefix": "permit_vabeach",
        "platform": "ckan",
        "base_url": "https://data.virginia.gov/api/3/action/datastore_search",
        "resource_id": "d66e8fbe-ce6f-431b-873b-b017a8c42861",
        "page_size": 100,
        "desc_field": "WorkDesc",
        "alt_desc_field": "workdesc",
        "id_field": "PermitNumber",
        "alt_id_field": "permitnumber",
    },
    "boston_ckan": {
        "name": "Boston (CKAN)",
        "prefix": "permit_boston_ckan",
        "platform": "ckan",
        "base_url": "https://data.boston.gov/api/3/action/datastore_search",
        "resource_id": "6ddcd912-32a0-43df-9908-63574f8c7e77",
        "page_size": 100,
        "desc_field": "Comments",
        "extra_desc_fields": ["WorkType"],
        "alt_desc_field": "comments",
        "id_field": "PermitNumber",
        "alt_id_field": "permitnumber",
    },
    "tampa": {
        "name": "Tampa",
        "prefix": "permit_tampa",
        "platform": "ckan",
        "base_url": "https://www.civicdata.com/api/3/action/datastore_search",
        "resource_id": "474844a7-3bd1-4722-bc8b-9ec5a5f82508",
        "page_size": 100,
        "desc_field": "Description",
        "alt_desc_field": "description",
        "id_field": "PermitNum",
        "alt_id_field": "permitnum",
    },
    "leon_county": {
        "name": "Leon County",
        "prefix": "permit_leon",
        "platform": "ckan",
        "base_url": "https://www.civicdata.com/api/3/action/datastore_search",
        "resource_id": "4e34687e-deba-428b-9509-921516df6208",
        "page_size": 100,
        "desc_field": "Description",
        "alt_desc_field": "description",
        "id_field": "PermitNum",
        "alt_id_field": "permitnum",
    },
    "pittsburgh": {
        "name": "Pittsburgh",
        "prefix": "permit_pittsburgh",
        "platform": "ckan",
        "base_url": "https://data.wprdc.org/api/3/action/datastore_search",
        "resource_id": "f4d1177a-f597-4c32-8cbf-7885f56253f6",
        "page_size": 100,
        "desc_field": "work_description",
        "id_field": "permit_id",
    },

    # --- Socrata cities ---
    "henderson": {
        "name": "Henderson",
        "prefix": "permit_henderson",
        "platform": "socrata",
        "base_url": "https://performance.cityofhenderson.com/resource/fpc9-568j.json",
        "desc_field": "permitdescription",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num"],
        "filter": "$where=UPPER(permitdescription) LIKE '%25SOLAR%25' OR UPPER(permittype) LIKE '%25PHOTOVOLTAIC%25' OR UPPER(permittype) LIKE '%25PV%25'",
    },
    "richmond_ca": {
        "name": "Richmond CA",
        "prefix": "permit_richmond",
        "platform": "socrata",
        "base_url": "https://data.ci.richmond.ca.us/resource/u29e-xr5h.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "corona": {
        "name": "Corona",
        "prefix": "permit_corona",
        "platform": "socrata",
        "base_url": "https://corstat.coronaca.gov/resource/2agx-camz.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num"],
        "filter": "$where=" + SOLAR_WHERE.format(desc="description") + " OR UPPER(permitsubtype) LIKE '%25SOLAR%25'",
    },
    "marin": {
        "name": "Marin County",
        "prefix": "permit_marin",
        "platform": "socrata",
        "base_url": "https://data.marincounty.gov/resource/mkbn-caye.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num"],
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "sonoma": {
        "name": "Sonoma County",
        "prefix": "permit_sonoma",
        "platform": "socrata",
        "base_url": "https://data.sonomacounty.ca.gov/resource/88ms-k5e7.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "objectid"],
        "filter": "$where=" + SOLAR_WHERE.format(desc="description"),
    },
    "pierce_county": {
        "name": "Pierce County",
        "prefix": "permit_pierce",
        "platform": "socrata",
        "base_url": "https://open.piercecountywa.gov/resource/rcj9-mkn4.json",
        "desc_field": "workdescription",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "objectid"],
        "filter": "$where=UPPER(workdescription) LIKE '%25SOLAR%25'",
    },
    "little_rock": {
        "name": "Little Rock",
        "prefix": "permit_littlerock",
        "platform": "socrata",
        "base_url": "https://data.littlerock.gov/resource/mkfu-qap3.json",
        "desc_field": "projectdesc",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "objectid"],
        "filter": "$where=UPPER(projectdesc) LIKE '%25SOLAR%25'",
    },
    "pgcounty": {
        "name": "Prince George's County",
        "prefix": "permit_pgcounty",
        "platform": "socrata",
        "base_url": "https://data.princegeorgescountymd.gov/resource/weik-ttee.json",
        "desc_field": "case_name",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "case_number", "objectid"],
        "filter": "$where=UPPER(case_name) LIKE '%25SOLAR%25'",
    },
    "framingham": {
        "name": "Framingham",
        "prefix": "permit_framingham",
        "platform": "socrata",
        "base_url": "https://data.framinghamma.gov/resource/2vzw-yean.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "objectid"],
        "filter": "$where=" + SOLAR_WHERE.format(desc="description") + " OR UPPER(sub_type) LIKE '%25SOLAR%25'",
    },
    "somerville": {
        "name": "Somerville",
        "prefix": "permit_somerville",
        "platform": "socrata",
        "base_url": "https://data.somervillema.gov/resource/vxgw-vmky.json",
        "desc_field": "work",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num", "objectid"],
        "filter": "$where=UPPER(work) LIKE '%25SOLAR%25'",
    },
    "collin_tx": {
        "name": "Collin County TX",
        "prefix": "permit_collintx",
        "platform": "socrata",
        "base_url": "https://data.texas.gov/resource/82ee-gbj5.json",
        "desc_field": "permittypedescr",
        "id_field": "permitnumber",
        "id_fields": ["permitnumber", "permit_number", "permit_num"],
        "filter": "$where=UPPER(permittypedescr) LIKE '%25SOLAR%25'",
    },
    "cincinnati": {
        "name": "Cincinnati",
        "prefix": "permit_cincinnati",
        "platform": "socrata",
        "base_url": "https://data.cincinnati-oh.gov/resource/cfkj-xb9y.json",
        "desc_field": "description",
        "id_field": "permit_number",
        "id_fields": ["permitnumber", "permit_number", "permit_num"],
        "filter": "$where=UPPER(companyname) LIKE '%25SOLAR%25' OR UPPER(companyname) LIKE '%25SUNRUN%25' OR UPPER(companyname) LIKE '%25TESLA%25' OR UPPER(companyname) LIKE '%25PHOTOVOLTAIC%25'",
    },

    # --- OpenDataSoft ---
    "memphis": {
        "name": "Memphis",
        "prefix": "permit_memphis",
        "platform": "opendatasoft",
        "base_url": "https://datamidsouth.opendatasoft.com/api/explore/v2.1/catalog/datasets/shelby-county-building-and-demolition-permits/records",
        "page_size": 100,
        "desc_field": "description",
        "id_field": "record_id",
        "alt_id_field": "permit_key",
        "filter": "where=description%20like%20%27SOLAR%27%20OR%20description%20like%20%27solar%27%20OR%20description%20like%20%27Solar%27%20OR%20description%20like%20%27PHOTOVOLTAIC%27",
    },
}


# ---------------------------------------------------------------------------
# API fetchers
# ---------------------------------------------------------------------------

def fetch_socrata(config):
    records = []
    offset = 0
    page_size = 1000
    while True:
        params = f"$limit={page_size}&$offset={offset}"
        if config.get("filter"):
            params += "&" + config["filter"]
        safe_chars = "$=&%'()"
        url = f"{config['base_url']}?{urllib.parse.quote(params, safe=safe_chars)}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        if not data:
            break
        records.extend(data)
        offset += len(data)
        if offset % 5000 == 0:
            print(f"    Fetched {offset}...")
        if len(data) < page_size:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_arcgis(config):
    records = []
    offset = 0
    page_size = 1000
    use_oid = config.get("oid_paging", False)
    last_oid = 0
    seen_oids = set()

    while True:
        where = config.get("arcgis_filter", "1=1")
        if use_oid and last_oid > 0:
            where = f"({where}) AND OBJECTID > {last_oid}"
        params = {
            "where": where,
            "outFields": "*",
            "resultRecordCount": page_size,
            "f": "json",
            "returnGeometry": "false",
        }
        if use_oid:
            params["orderByFields"] = "OBJECTID ASC"
        else:
            params["resultOffset"] = offset

        url = f"{config['base_url']}/query?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        features = data.get("features", [])
        if not features:
            break
        new_count = 0
        for feat in features:
            rec = feat.get("attributes", {})
            oid = rec.get("OBJECTID") or rec.get("ObjectId") or rec.get("objectid")
            if oid and oid in seen_oids:
                continue
            if oid:
                seen_oids.add(oid)
                last_oid = max(last_oid, oid)
            records.append(rec)
            new_count += 1
        offset += len(features)
        if offset % 5000 == 0:
            print(f"    Fetched {len(records)}...")
        if new_count == 0:
            break
        if not data.get("exceededTransferLimit", False) and len(features) < page_size:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_arcgis_multilayer(config):
    """Fetch from multiple ArcGIS FeatureServer layers and combine."""
    all_records = []
    base = config["base_url"]
    layers = config.get("layers", [0])
    for layer_id in layers:
        layer_config = dict(config)
        layer_config["base_url"] = f"{base}/{layer_id}"
        print(f"    Layer {layer_id}...")
        records = fetch_arcgis(layer_config)
        print(f"      {len(records)} records from layer {layer_id}")
        all_records.extend(records)
    return all_records


def fetch_carto(config):
    records = []
    offset = 0
    page_size = 1000
    while True:
        where = config.get("carto_filter", "1=1")
        table = config.get("table_name", "permits")
        sql = f"SELECT * FROM {table} WHERE {where} LIMIT {page_size} OFFSET {offset}"
        params = urllib.parse.urlencode({"q": sql, "format": "json"})
        url = f"{config['base_url']}?{params}"
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        rows = data.get("rows", [])
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        if len(rows) < page_size:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_ckan(config):
    records = []
    offset = 0
    page_size = config.get("page_size", 100)
    while True:
        params = {
            "resource_id": config["resource_id"],
            "limit": page_size,
            "offset": offset,
        }
        if "ckan_filters" in config:
            params["filters"] = json.dumps(config["ckan_filters"])
        else:
            params["q"] = "solar"
        url = f"{config['base_url']}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        # CivicData CKAN returns 403 without User-Agent header
        if "civicdata.com" in config["base_url"]:
            req.add_header("User-Agent", "SolarTrack/1.0")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        result = data.get("result", {})
        rows = result.get("records", [])
        if not rows:
            break
        records.extend(rows)
        offset += len(rows)
        total = result.get("total", 0)
        if offset >= total:
            break
        time.sleep(RATE_LIMIT)
    return records


def fetch_opendatasoft(config):
    """Fetch all records from OpenDataSoft API (v2.1)."""
    records = []
    offset = 0
    page_size = config.get("page_size", 100)
    while True:
        url = f"{config['base_url']}?limit={page_size}&offset={offset}"
        if config.get("filter"):
            url += "&" + config["filter"]
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            print(f"    API error at offset {offset}: {e}")
            break
        batch = data.get("results", data.get("records", []))
        if not batch:
            break
        for rec in batch:
            if "record" in rec and "fields" in rec.get("record", {}):
                fields = rec["record"]["fields"]
            elif "fields" in rec:
                fields = rec["fields"]
            else:
                fields = rec
            records.append(fields)
        offset += len(batch)
        total = data.get("total_count", 0)
        if offset >= total:
            break
        time.sleep(RATE_LIMIT)
    return records


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_get(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v), safe='.*,()')}" for k, v in params.items()
        )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            if attempt < 4:
                wait = 2 ** attempt
                print(f"    Retry {attempt+1}/5 after {e} (waiting {wait}s)")
                time.sleep(wait)
            else:
                raise


def supabase_post(table, records):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(records).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200] if hasattr(e, 'read') else str(e)
        print(f"    POST error ({e.code}): {err}")
        return False


def supabase_patch_single(table, record_id, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{record_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    try:
        urllib.request.urlopen(req)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_city(city_key, config, dry_run=False):
    """Re-query API, parse descriptions, create equipment records."""
    print(f"\n{'=' * 60}")
    print(f"Processing {config['name']} ({city_key})")
    print(f"{'=' * 60}")

    # Step 1: Load existing installations for this prefix
    print(f"  Loading installations (prefix: {config['prefix']})...")
    id_map = {}  # source_record_id -> {id, capacity_dc_kw, ...}
    offset = 0
    while True:
        batch = supabase_get("solar_installations", {
            "select": "id,source_record_id,capacity_dc_kw,capacity_mw",
            "source_record_id": f"like.{config['prefix']}_*",
            "limit": 1000,
            "offset": offset,
        })
        if not batch:
            break
        for r in batch:
            id_map[r["source_record_id"]] = r
        offset += len(batch)
        if len(batch) < 1000:
            break
    print(f"  Total installations: {len(id_map)}")

    if not id_map:
        return 0, 0, 0

    # Step 2: Check which have equipment already
    print(f"  Checking existing equipment...")
    has_equip = set()
    inst_ids = [r["id"] for r in id_map.values()]
    for i in range(0, len(inst_ids), 50):
        chunk = inst_ids[i:i + 50]
        try:
            batch = supabase_get("solar_equipment", {
                "select": "installation_id",
                "installation_id": f"in.({','.join(chunk)})",
            })
            for r in batch:
                has_equip.add(r["installation_id"])
        except Exception:
            pass
    need_equip = {sid: r for sid, r in id_map.items() if r["id"] not in has_equip}
    print(f"  Already have equipment: {len(has_equip)}")
    print(f"  Need equipment: {len(need_equip)}")

    if not need_equip:
        return 0, 0, 0

    # Step 3: Re-query API for descriptions
    print(f"  Fetching descriptions from API...")
    platform = config["platform"]
    try:
        if platform == "socrata":
            raw_records = fetch_socrata(config)
        elif platform == "arcgis_multilayer":
            raw_records = fetch_arcgis_multilayer(config)
        elif platform == "arcgis":
            raw_records = fetch_arcgis(config)
        elif platform == "carto":
            raw_records = fetch_carto(config)
        elif platform == "ckan":
            raw_records = fetch_ckan(config)
        elif platform == "opendatasoft":
            raw_records = fetch_opendatasoft(config)
        else:
            print(f"  Unknown platform: {platform}")
            return 0, 0, 0
    except Exception as e:
        print(f"  Error: {e}")
        return 0, 0, 0
    print(f"  Downloaded {len(raw_records)} records from API")

    # Step 4: Build source_id -> description map
    desc_field = config["desc_field"]
    alt_desc = config.get("alt_desc_field")
    id_field = config["id_field"]
    alt_id = config.get("alt_id_field")
    suffix_field = config.get("id_suffix_field")
    prefix = config["prefix"]

    desc_map = {}
    for raw in raw_records:
        permit_id = raw.get(id_field, "")
        if not permit_id and alt_id:
            permit_id = raw.get(alt_id, "")
        if not permit_id:
            for fallback in config.get("id_fields", []):
                val = raw.get(fallback)
                if val and str(val).strip():
                    permit_id = str(val).strip()
                    break
        if not permit_id:
            continue
        if suffix_field:
            suffix = raw.get(suffix_field, "01")
            source_id = f"{prefix}_{permit_id}_{suffix}"
        else:
            source_id = f"{prefix}_{permit_id}"

        desc = raw.get(desc_field, "")
        if not desc and alt_desc:
            desc = raw.get(alt_desc, "")
        # Concatenate additional description fields
        for extra_field in config.get("extra_desc_fields", []):
            extra = raw.get(extra_field, "")
            if extra and str(extra).strip() and str(extra).strip() != str(desc).strip():
                desc = f"{desc}. {extra}" if desc else str(extra)
        if desc:
            desc_map[source_id] = str(desc)

    print(f"  Descriptions mapped: {len(desc_map)}")

    # Step 5: Parse equipment from descriptions
    equip_to_create = []  # list of equipment dicts ready for batch POST
    capacity_updates = []  # list of (inst_id, capacity_kw)
    parsed_count = 0
    sample_count = 0

    for source_id, inst in need_equip.items():
        desc = desc_map.get(source_id)
        if not desc:
            continue

        equipment = parse_equipment_from_description(desc)
        if not equipment:
            continue

        parsed_count += 1
        inst_id = inst["id"]

        if dry_run:
            if sample_count < 10:
                parts = []
                for eq in equipment:
                    parts.append(f"{eq.get('equipment_type', '?')}:{eq.get('manufacturer', '-')}")
                print(f"    {source_id}: {', '.join(parts)}")
                sample_count += 1
            continue

        for eq in equipment:
            record = {
                "installation_id": inst_id,
                "equipment_type": eq.get("equipment_type"),
                "manufacturer": eq.get("manufacturer"),
                "model": eq.get("model"),
                "quantity": eq.get("quantity"),
                "specs": json.dumps(eq["specs"]) if eq.get("specs") else None,
                "data_source_id": None,
            }
            equip_to_create.append(record)

        # Derive capacity if missing
        if not inst.get("capacity_dc_kw") and not inst.get("capacity_mw"):
            cap_kw = parse_capacity_kw(desc)
            if not cap_kw:
                # Try deriving from panels × watts
                for eq in equipment:
                    if eq.get("equipment_type") == "module":
                        qty = eq.get("quantity")
                        specs = eq.get("specs", {})
                        w = specs.get("watts") if isinstance(specs, dict) else None
                        if qty and w:
                            cap_kw = qty * w / 1000
            if cap_kw and 0.1 <= cap_kw <= 100000:
                capacity_updates.append((inst_id, cap_kw))

    print(f"  Descriptions with extractable equipment: {parsed_count}")
    print(f"  Equipment records to create: {len(equip_to_create)}")
    print(f"  Capacity derivable: {len(capacity_updates)}")

    if dry_run:
        return parsed_count, 0, 0

    # Step 6: Batch insert equipment
    created = 0
    errors = 0
    for i in range(0, len(equip_to_create), BATCH_SIZE):
        batch = equip_to_create[i:i + BATCH_SIZE]
        if supabase_post("solar_equipment", batch):
            created += len(batch)
        else:
            errors += len(batch)
        if (i + BATCH_SIZE) % 500 < BATCH_SIZE:
            print(f"    Equipment: {created} created, {errors} errors")

    print(f"  Equipment created: {created}, errors: {errors}")

    # Step 7: Update capacity
    cap_updated = 0
    for inst_id, cap_kw in capacity_updates:
        patch = {
            "capacity_dc_kw": cap_kw,
            "capacity_mw": round(cap_kw / 1000, 3),
        }
        if supabase_patch_single("solar_installations", inst_id, patch):
            cap_updated += 1
    if cap_updated:
        print(f"  Capacity updated: {cap_updated}")

    return parsed_count, created, cap_updated


def main():
    parser = argparse.ArgumentParser(description="Parse permit descriptions for equipment data")
    parser.add_argument("--dry-run", action="store_true", help="Preview without creating records")
    parser.add_argument("--city", type=str, help="City key(s), comma-separated")
    parser.add_argument("--list", action="store_true", help="List available cities")
    args = parser.parse_args()

    if args.list:
        print("Available cities:")
        for key, cfg in sorted(CITY_CONFIGS.items()):
            print(f"  {key:20s} {cfg['name']:25s} ({cfg['platform']})")
        return

    print("Permit Description Equipment Parser")
    print("=" * 60)
    print(f"  Dry run: {args.dry_run}")

    if args.city:
        keys = [k.strip() for k in args.city.split(",")]
        cities = {}
        for k in keys:
            if k not in CITY_CONFIGS:
                print(f"  Warning: Unknown city '{k}'")
                continue
            cities[k] = CITY_CONFIGS[k]
    else:
        cities = CITY_CONFIGS

    print(f"  Cities: {len(cities)}")

    total_parsed = 0
    total_created = 0
    total_capacity = 0

    for key, config in cities.items():
        parsed, created, cap = process_city(key, config, args.dry_run)
        total_parsed += parsed
        total_created += created
        total_capacity += cap

    print(f"\n{'=' * 60}")
    print(f"Summary")
    print(f"{'=' * 60}")
    print(f"  Descriptions with equipment: {total_parsed}")
    if not args.dry_run:
        print(f"  Equipment records created: {total_created}")
        print(f"  Capacity values updated: {total_capacity}")
    print(f"\nDone!")


if __name__ == "__main__":
    main()
