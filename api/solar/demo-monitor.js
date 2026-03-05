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

  // Require master password — this is an admin endpoint
  const { password } = req.query;
  if (password !== "CHECKITOUT") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const supabase = getSupabase();

    // Fetch all tokens
    const { data: tokens, error: tokensErr } = await supabase
      .from("solar_demo_tokens")
      .select("*")
      .order("created_at", { ascending: true });

    if (tokensErr) return res.status(500).json({ error: tokensErr.message });

    // Fetch usage aggregates per token
    const { data: usageRows, error: usageErr } = await supabase
      .from("solar_demo_usage")
      .select("token, date, hour, request_count");

    if (usageErr) return res.status(500).json({ error: usageErr.message });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentHour = now.getUTCHours();

    // Aggregate usage per token
    const usageMap = {};
    for (const row of usageRows || []) {
      if (!usageMap[row.token]) usageMap[row.token] = { lifetime: 0, today: 0, thisHour: 0 };
      const u = usageMap[row.token];
      u.lifetime += row.request_count;
      if (row.date === todayStr) {
        u.today += row.request_count;
        if (row.hour === currentHour) u.thisHour += row.request_count;
      }
    }

    const result = tokens.map(t => {
      const u = usageMap[t.token] || { lifetime: 0, today: 0, thisHour: 0 };
      return {
        token: t.token,
        label: t.label,
        is_active: t.is_active,
        created_at: t.created_at,
        expires_at: t.expires_at,
        limits: {
          hourly: t.hourly_limit,
          daily: t.daily_limit,
          lifetime: t.lifetime_limit,
        },
        usage: {
          this_hour: u.thisHour,
          today: u.today,
          lifetime: u.lifetime,
        },
        remaining: {
          hourly: Math.max(0, t.hourly_limit - u.thisHour),
          daily: Math.max(0, t.daily_limit - u.today),
          lifetime: t.lifetime_limit ? Math.max(0, t.lifetime_limit - u.lifetime) : null,
        },
        expired: t.lifetime_limit ? u.lifetime >= t.lifetime_limit : false,
        time_expired: t.expires_at ? new Date(t.expires_at) < now : false,
      };
    });

    return res.status(200).json({
      tokens: result,
      total_tokens: result.length,
      active_tokens: result.filter(t => t.is_active && !t.expired && !t.time_expired).length,
      checked_at: now.toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
