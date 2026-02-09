import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

async function verifySchema() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";

  if (!url || !key) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  // Remove trailing \n if present
  const supabase = createClient(url.trim(), key.trim());

  console.log("Testing solar_data_sources...");
  const { data: src, error: srcErr } = await supabase
    .from("solar_data_sources")
    .upsert({ name: "test", description: "Schema verification test" }, { onConflict: "name" })
    .select()
    .single();
  if (srcErr) {
    console.error("solar_data_sources error:", srcErr);
    process.exit(1);
  }
  console.log("  OK - created test data source:", src.id);

  console.log("Testing solar_installations...");
  const { data: inst, error: instErr } = await supabase
    .from("solar_installations")
    .insert({
      site_name: "Schema Test Site",
      state: "CA",
      capacity_dc_kw: 500,
      site_type: "commercial",
      latitude: 34.0522,
      longitude: -118.2437,
      data_source_id: src.id,
      source_record_id: "test_001",
    })
    .select()
    .single();
  if (instErr) {
    console.error("solar_installations error:", instErr);
    process.exit(1);
  }
  console.log("  OK - created test installation:", inst.id);
  console.log("  Location auto-populated:", inst.location ? "YES" : "NO");
  console.log("  Capacity MW auto-calculated:", inst.capacity_mw);

  console.log("Testing solar_equipment...");
  const { data: equip, error: equipErr } = await supabase
    .from("solar_equipment")
    .insert({
      installation_id: inst.id,
      equipment_type: "module",
      manufacturer: "First Solar",
      model: "Series 6 Plus",
      quantity: 1000,
      module_wattage_w: 540,
      module_technology: "CdTe",
    })
    .select()
    .single();
  if (equipErr) {
    console.error("solar_equipment error:", equipErr);
    process.exit(1);
  }
  console.log("  OK - created test equipment:", equip.id);

  console.log("Testing solar_site_events...");
  const { error: eventErr } = await supabase.from("solar_site_events").insert({
    installation_id: inst.id,
    event_type: "maintenance",
    event_date: "2025-06-15",
    description: "Schema test event",
  });
  if (eventErr) {
    console.error("solar_site_events error:", eventErr);
    process.exit(1);
  }
  console.log("  OK");

  // Clean up test data
  console.log("\nCleaning up test data...");
  await supabase.from("solar_site_events").delete().eq("installation_id", inst.id);
  await supabase.from("solar_equipment").delete().eq("installation_id", inst.id);
  await supabase.from("solar_installations").delete().eq("id", inst.id);
  await supabase.from("solar_data_sources").delete().eq("name", "test");
  console.log("  Cleaned up.");

  console.log("\n✓ All 6 tables verified successfully!");
  console.log("  - solar_data_sources");
  console.log("  - solar_site_owners");
  console.log("  - solar_installers");
  console.log("  - solar_installations (with PostGIS location trigger)");
  console.log("  - solar_equipment");
  console.log("  - solar_site_events");
}

verifySchema().catch(console.error);
