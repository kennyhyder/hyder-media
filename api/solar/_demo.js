import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

/**
 * Check demo access for a request.
 * Returns { mode: "full" } for master password users (no token),
 * or { mode: "demo", label, dailyRemaining, hourlyRemaining } for demo tokens.
 * Returns null if response was already sent (401/429).
 */
export async function checkDemoAccess(req, res) {
  const token = req.query?.demo_token
    || (req.headers?.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);

  // No token = full access (master password user)
  if (!token) return { mode: "full" };

  const supabase = getSupabase();

  // Validate token
  const { data: tokenRow, error } = await supabase
    .from("solar_demo_tokens")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .single();

  if (error || !tokenRow) {
    res.status(401).json({ error: "Invalid or inactive demo token" });
    return null;
  }

  // Check expiry
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    res.status(401).json({ error: "Demo token has expired", contact: "kenny@hyder.me" });
    return null;
  }

  // Increment usage and check rate limits
  const { data: usage, error: usageError } = await supabase
    .rpc("increment_demo_usage", { p_token: token });

  if (usageError) {
    // If RPC fails, allow the request but log
    console.error("Demo usage tracking error:", usageError.message);
    return { mode: "demo", label: tokenRow.label, dailyRemaining: 999, hourlyRemaining: 999 };
  }

  const dailyTotal = usage?.[0]?.daily_total || 0;
  const hourlyTotal = usage?.[0]?.hourly_total || 0;

  if (hourlyTotal > tokenRow.hourly_limit) {
    res.status(429).json({
      error: "Hourly rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "1 hour",
    });
    return null;
  }

  if (dailyTotal > tokenRow.daily_limit) {
    res.status(429).json({
      error: "Daily rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "tomorrow",
    });
    return null;
  }

  return {
    mode: "demo",
    label: tokenRow.label,
    dailyRemaining: tokenRow.daily_limit - dailyTotal,
    hourlyRemaining: tokenRow.hourly_limit - hourlyTotal,
  };
}
