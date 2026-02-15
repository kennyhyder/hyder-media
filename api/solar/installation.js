import { createClient } from "@supabase/supabase-js";
import { InstallationQuery, validate } from "./_validate.js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const params = validate(InstallationQuery, req.query, res);
  if (!params) return;
  const { id } = params;

  try {
    const supabase = getSupabase();

    // Get installation
    const { data: installation, error } = await supabase
      .from("solar_installations")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return res.status(404).json({ error: "Installation not found" });

    // Get equipment
    const { data: equipment } = await supabase
      .from("solar_equipment")
      .select("*")
      .eq("installation_id", id)
      .order("equipment_type");

    // Get events
    const { data: events } = await supabase
      .from("solar_site_events")
      .select("*")
      .eq("installation_id", id)
      .order("event_date", { ascending: false });

    return res.status(200).json({
      data: {
        ...installation,
        equipment: equipment || [],
        events: events || [],
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
