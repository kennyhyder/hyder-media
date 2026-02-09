import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

async function clean() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  const supabase = createClient(url, key);

  console.log("Cleaning up partial USPVDB import...");

  // Get USPVDB source ID
  const { data: source } = await supabase
    .from("solar_data_sources")
    .select("id")
    .eq("name", "uspvdb")
    .single();

  if (source) {
    // Delete equipment for USPVDB installations
    const { data: installations } = await supabase
      .from("solar_installations")
      .select("id")
      .eq("data_source_id", source.id);

    if (installations && installations.length > 0) {
      const ids = installations.map((i: any) => i.id);
      console.log(`Deleting equipment for ${ids.length} installations...`);

      // Delete in batches
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        await supabase.from("solar_equipment").delete().in("installation_id", batch);
        await supabase.from("solar_site_events").delete().in("installation_id", batch);
      }
    }

    // Delete installations
    const { error } = await supabase
      .from("solar_installations")
      .delete()
      .eq("data_source_id", source.id);
    console.log("Deleted installations:", error ? error.message : "OK");

    // Reset source count
    await supabase
      .from("solar_data_sources")
      .update({ record_count: 0, last_import: null })
      .eq("id", source.id);
  }

  console.log("Clean up complete. Ready for re-ingestion.");
}

clean().catch(console.error);
