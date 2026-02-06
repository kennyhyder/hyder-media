/**
 * USPVDB Ingestion Script
 * Downloads and imports utility-scale solar installations (≥1 MW) from USGS USPVDB
 * Source: https://energy.usgs.gov/uspvdb/
 *
 * USPVDB GeoJSON field names (v3.0, April 2025):
 *   case_id, eia_id, p_state, p_county, ylat, xlong, p_name, p_year,
 *   p_cap_ac (MW), p_cap_dc (MW), p_tech_pri, p_axis, p_azimuth, p_tilt,
 *   p_battery, p_sys_type, p_type, p_agrivolt
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync, existsSync, readFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const BATCH_SIZE = 50;
const DATA_SOURCE_NAME = "uspvdb";
const DATA_DIR = resolve(__dirname, "../data");
const USPVDB_GEOJSON_ZIP_URL = "https://eerscmap.usgs.gov/uspvdb/assets/data/uspvdbGeoJSON.zip";

async function downloadUSPVDB(): Promise<any> {
  const cachedPath = resolve(DATA_DIR, "uspvdb.json");

  if (existsSync(cachedPath)) {
    console.log("Using cached USPVDB data from data/uspvdb.json");
    return JSON.parse(readFileSync(cachedPath, "utf-8"));
  }

  console.log("Downloading USPVDB GeoJSON zip...");
  const response = await fetch(USPVDB_GEOJSON_ZIP_URL);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zipPath = resolve(DATA_DIR, "uspvdb.zip");
  writeFileSync(zipPath, buffer);
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  console.log("Extracting...");
  const { execSync } = await import("child_process");
  execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}/uspvdb_extract"`, { stdio: "pipe" });

  const { readdirSync } = await import("fs");
  const extractDir = resolve(DATA_DIR, "uspvdb_extract");
  const files = readdirSync(extractDir);
  const geojsonFile = files.find((f: string) => f.endsWith(".geojson") || f.endsWith(".json"));
  if (!geojsonFile) throw new Error("No GeoJSON file found in zip. Files: " + files.join(", "));

  const data = JSON.parse(readFileSync(resolve(extractDir, geojsonFile), "utf-8"));
  console.log(`Loaded ${data.features?.length || "?"} features`);
  writeFileSync(cachedPath, JSON.stringify(data));
  return data;
}

function normalizeTracking(axis: string | null | undefined): string | null {
  if (!axis) return null;
  const lower = axis.toLowerCase().trim();
  if (lower.includes("single")) return "single-axis";
  if (lower.includes("dual")) return "dual-axis";
  if (lower.includes("fixed")) return "fixed";
  if (lower === "none") return "fixed";
  return axis;
}

function parseFeature(feature: any): { installation: any; equipment: any[] } | null {
  const p = feature.properties;
  if (!p) return null;

  const capAcMw = parseFloat(p.p_cap_ac) || 0;
  const capDcMw = parseFloat(p.p_cap_dc) || 0;
  if (!capAcMw && !capDcMw) return null;

  const installation = {
    site_name: p.p_name || null,
    site_type: "utility",
    latitude: parseFloat(p.ylat) || null,
    longitude: parseFloat(p.xlong) || null,
    state: p.p_state ? p.p_state.substring(0, 2).toUpperCase() : null,
    county: p.p_county || null,
    capacity_ac_kw: capAcMw ? Math.round(capAcMw * 1000 * 100) / 100 : null,
    capacity_dc_kw: capDcMw ? Math.round(capDcMw * 1000 * 100) / 100 : null,
    capacity_mw: capAcMw || capDcMw || null,
    tracking_type: normalizeTracking(p.p_axis),
    mount_type: p.p_sys_type || "ground",
    install_date: p.p_year ? `${p.p_year}-01-01` : null,
    has_battery_storage: p.p_battery === "yes" || p.p_battery === true,
    site_status: "active",
    source_record_id: `uspvdb_${p.case_id}`,
  };

  const equipment: any[] = [];
  if (p.p_tech_pri) {
    equipment.push({
      equipment_type: "module",
      module_technology: p.p_tech_pri,
      specs: {
        tilt: p.p_tilt,
        azimuth: p.p_azimuth,
        eia_id: p.eia_id,
        site_type_detail: p.p_type,
        agrivoltaics: p.p_agrivolt,
      },
    });
  }

  return { installation, equipment };
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) { console.error("Missing Supabase credentials"); process.exit(1); }

  const supabase = createClient(url, key);

  // Register data source
  const { data: source } = await supabase
    .from("solar_data_sources")
    .upsert({ name: DATA_SOURCE_NAME, description: "USGS U.S. Large-Scale Solar Photovoltaic Database (≥1 MW)", url: "https://energy.usgs.gov/uspvdb/" }, { onConflict: "name" })
    .select().single();
  if (!source) { console.error("Failed to register data source"); process.exit(1); }
  console.log(`Data source: ${source.id}`);

  const rawData = await downloadUSPVDB();
  const features = rawData.features || rawData;
  console.log(`\nProcessing ${features.length} features...`);

  let total = 0;
  let skipped = 0;
  let equipTotal = 0;

  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const chunk = features.slice(i, i + BATCH_SIZE);
    const parsed = chunk.map(parseFeature).filter(Boolean) as { installation: any; equipment: any[] }[];
    skipped += chunk.length - parsed.length;

    if (parsed.length === 0) continue;

    const instRecords = parsed.map(p => ({ ...p.installation, data_source_id: source.id }));

    // Use insert (not upsert) since we cleaned first
    const { data: inserted, error } = await supabase
      .from("solar_installations")
      .insert(instRecords)
      .select("id, source_record_id");

    if (error) {
      console.error(`Batch error at ${i}: ${error.message}`);
      // Fall back to one-by-one
      for (const record of instRecords) {
        const { data: single, error: singleErr } = await supabase
          .from("solar_installations")
          .insert(record)
          .select("id, source_record_id");
        if (singleErr) {
          console.error(`  Skip ${record.source_record_id}: ${singleErr.message}`);
          skipped++;
        } else if (single && single.length > 0) {
          total++;
          // Insert equipment
          const p = parsed.find(x => x.installation.source_record_id === single[0].source_record_id);
          if (p && p.equipment.length > 0) {
            const eqRecords = p.equipment.map(eq => ({ ...eq, installation_id: single[0].id, data_source_id: source.id }));
            await supabase.from("solar_equipment").insert(eqRecords);
            equipTotal += eqRecords.length;
          }
        }
      }
    } else if (inserted) {
      total += inserted.length;
      // Insert equipment for all inserted installations
      const eqBatch: any[] = [];
      for (const inst of inserted) {
        const p = parsed.find(x => x.installation.source_record_id === inst.source_record_id);
        if (p && p.equipment.length > 0) {
          for (const eq of p.equipment) {
            eqBatch.push({ ...eq, installation_id: inst.id, data_source_id: source.id });
          }
        }
      }
      if (eqBatch.length > 0) {
        const { error: eqErr } = await supabase.from("solar_equipment").insert(eqBatch);
        if (eqErr) console.error(`  Equipment batch error: ${eqErr.message}`);
        else equipTotal += eqBatch.length;
      }
    }

    if (total % 500 === 0 || i + BATCH_SIZE >= features.length) {
      console.log(`  ${total} installations, ${equipTotal} equipment records (${skipped} skipped)`);
    }
  }

  // Update source count
  await supabase
    .from("solar_data_sources")
    .update({ record_count: total, last_import: new Date().toISOString() })
    .eq("id", source.id);

  console.log(`\n✓ USPVDB ingestion complete!`);
  console.log(`  Installations: ${total}`);
  console.log(`  Equipment records: ${equipTotal}`);
  console.log(`  Skipped: ${skipped}`);
}

main().catch(console.error);
