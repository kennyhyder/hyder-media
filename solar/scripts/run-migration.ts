import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

async function runMigration() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const sqlPath = join(__dirname, "001-create-schema.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  // Split into individual statements and run each
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Running ${statements.length} SQL statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, " ");
    console.log(`[${i + 1}/${statements.length}] ${preview}...`);

    const { error } = await supabase.rpc("exec_sql", { sql_text: stmt });

    if (error) {
      // Try direct query if rpc doesn't work
      const { error: error2 } = await supabase.from("_migrations").select("*").limit(0);
      if (error2) {
        console.log(`  Note: RPC not available. SQL must be run in Supabase SQL Editor.`);
        console.log(`  Statement: ${preview}`);
      }
    }
  }

  console.log("\nMigration script complete.");
  console.log("If RPC was not available, copy scripts/001-create-schema.sql");
  console.log("and run it in the Supabase SQL Editor at:");
  console.log(`${supabaseUrl}/project/default/sql`);
}

runMigration().catch(console.error);
