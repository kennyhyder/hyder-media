# BLM Solar Designated Leasing Areas (DLA) - API Reference

## ✅ WORKING URL FOUND

**Service**: BLM Energy Designations FeatureServer (hosted on BLM/Interior ArcGIS)
```
Base: https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer

Layer 10: BLM Solar Energy Zone (Designated Leasing Areas)
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10
```

---

## 📊 Data Summary

| Metric | Value |
|--------|-------|
| Total Polygons | 153 |
| Total Area | 527,823 acres (825 sq miles) |
| Geometry Type | esriGeometryPolygon (Web Mercator EPSG:3857) |
| States Covered | CO, NM, UT, AZ, NV, CA |

**Note**: The 527K acres represents designated leasing areas where solar is allowed. The "31 million acres" often cited refers to the total PEIS study area, which is much broader and includes excluded areas, existing facilities, and ROWs.

---

## 📋 Field Definitions

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `ogc_fid` | OID | 1 | Unique object ID |
| `zone_name` | String | "Antonito Southeast" | SEZ name |
| `stateoffice` | String | "Colorado" | BLM state office |
| `status` | String | "Developable" or "Non-developable" | Allows solar development? |
| `comments` | String | "No development in wetlands/dry lake" | Restrictions/notes |
| `Shape__Area` | Double | 61785020.71 | Polygon area in m² |
| `Shape__Length` | Double | 51671.45 | Polygon perimeter in m |

---

## 📍 Sample Records

```json
{
  "ogc_fid": 1,
  "zone_name": "Antonito Southeast",
  "stateoffice": "Colorado",
  "status": "Developable",
  "comments": null,
  "Shape__Area": 61785020.71,
  "Shape__Length": 51671.45
}
```

```json
{
  "ogc_fid": 2,
  "zone_name": "Antonito Southeast",
  "stateoffice": "Colorado",
  "status": "Non-developable",
  "comments": "No development in wetlands/dry lake",
  "Shape__Area": 1724.91,
  "Shape__Length": 154.55
}
```

---

## 🔗 Query Examples

### Count all zones
```
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query?where=1=1&returnCountOnly=true&f=json
```
**Response**: `{"count": 153}`

### Get all developable areas
```
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query?where=status='Developable'&outFields=*&returnGeometry=true&f=json
```

### Filter by state
```
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query?where=stateoffice='Colorado'&outFields=*&f=json
```

### Get specific zone
```
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query?where=zone_name='Antonito%20Southeast'&outFields=*&f=json
```

### Large export (all records as GeoJSON)
```
https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query?where=1=1&outFields=*&returnGeometry=true&f=geojson
```

---

## ⚠️ Important Notes

1. **Coordinates are Web Mercator (EPSG:3857)** — Convert to WGS84 (EPSG:4326) for ground truth:
   - Example: `[-11797466.8842, 4444919.7848]` → `[-105.95°, 37.13°]`

2. **Polygons represent zones**, not individual projects
   - Each SEZ may have multiple polygons (developable areas separate from wetlands/non-developable areas)

3. **Status field is critical**:
   - `"Developable"` = solar projects allowed here
   - `"Non-developable"` = restrictions apply (wetlands, other protections)

4. **Comments field may contain important restrictions**:
   - "No development in wetlands/dry lake"
   - Environmental or legal constraints

5. **Max record count is 2000** per request
   - 153 total records fits in one request
   - Use `where` clause to reduce results if needed

---

## 📌 For Python Scripts

```python
import requests

# Get all DLA zones
url = "https://services1.arcgis.com/KbxwQRRfWyEYLgp4/arcgis/rest/services/Energy_Designations/FeatureServer/10/query"
params = {
    'where': '1=1',
    'outFields': '*',
    'returnGeometry': 'true',
    'f': 'json'
}

response = requests.get(url, params=params)
zones = response.json()['features']

for zone in zones:
    attrs = zone['attributes']
    print(f"{attrs['zone_name']} ({attrs['stateoffice']}): {attrs['status']}")
```

---

## 📡 Additional Related Layers (same Energy_Designations service)

| Layer | Name | Purpose |
|-------|------|---------|
| 2 | Section 368 Designated Corridor - Current | Energy transmission corridors |
| 10 | **BLM Solar Energy Zone** | **← DLA (527K acres)** |
| 12 | BLM DRECP Development Focus Area | Broader solar development areas |
| 14 | BLM AZ Renewable Energy Dev. Areas | Arizona-specific renewable areas |
| 15 | WGA Western Renewable Energy Zone | Multi-state renewable overlay |

---

## 🔴 Previous Incorrect URL (Reference)

```
https://services1.arcgis.com/SyUSN23vOoYdfLC8/arcgis/rest/services/BLM_Natl_Solar_Designated_Leasing_Areas/FeatureServer/0
```
- **Problem**: Wrong organization ID (`SyUSN23vOoYdfLC8` instead of `KbxwQRRfWyEYLgp4`)
- **Returned**: HTTP 400 "Invalid URL"
- **Lesson**: The BLM GIS hub has multiple organizations; search carefully
