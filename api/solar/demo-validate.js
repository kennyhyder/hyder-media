import { createClient } from "@supabase/supabase-js";

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

  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false, error: "Token required" });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("solar_demo_tokens")
      .select("label, expires_at, is_active")
      .eq("token", token)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return res.status(200).json({ valid: false });
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(200).json({ valid: false, error: "Token expired" });
    }

    return res.status(200).json({ valid: true, label: data.label });
  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
}
