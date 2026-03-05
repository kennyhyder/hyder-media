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
    // If RPC fails, block the request — don't silently allow unlimited access
    console.error("Demo usage tracking error:", usageError.message);
    res.status(503).json({ error: "Demo access temporarily unavailable", contact: "kenny@hyder.me" });
    return null;
  }

  const dailyTotal = usage?.[0]?.daily_total || 0;
  const hourlyTotal = usage?.[0]?.hourly_total || 0;

  if (hourlyTotal > tokenRow.hourly_limit) {
    res.status(429).json({
      error: "Hourly rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "in about an hour",
      demo_limits: { hourly_limit: tokenRow.hourly_limit, daily_limit: tokenRow.daily_limit, hourly_used: hourlyTotal, daily_used: dailyTotal },
    });
    return null;
  }

  if (dailyTotal > tokenRow.daily_limit) {
    res.status(429).json({
      error: "Daily rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "tomorrow",
      demo_limits: { hourly_limit: tokenRow.hourly_limit, daily_limit: tokenRow.daily_limit, hourly_used: hourlyTotal, daily_used: dailyTotal },
    });
    return null;
  }

  return {
    mode: "demo",
    label: tokenRow.label,
    hourlyLimit: tokenRow.hourly_limit,
    dailyLimit: tokenRow.daily_limit,
    dailyRemaining: tokenRow.daily_limit - dailyTotal,
    hourlyRemaining: tokenRow.hourly_limit - hourlyTotal,
  };
}

/**
 * Fields redacted from demo responses to protect commercial value.
 * Demo users see site_type, state, county, capacity, dates, site_status —
 * enough to evaluate the product, not enough to extract the database.
 */
const REDACTED_FIELDS = [
  "owner_name", "developer_name", "installer_name", "operator_name",
  "address", "zip_code",
  "owner_id", "developer_id", "installer_id", "operator_id",
  "total_cost", "cost_per_watt", "offtaker_name", "ppa_price_mwh",
  "source_record_id", "crossref_ids", "data_source_id",
];

/**
 * Redact sensitive fields from an installation record for demo mode.
 * Replaces values with null and adds a demo_redacted flag.
 */
export function redactForDemo(record) {
  if (!record) return record;
  const redacted = { ...record };
  for (const field of REDACTED_FIELDS) {
    if (field in redacted && redacted[field] != null) {
      redacted[field] = null;
    }
  }
  redacted._demo_redacted = true;
  return redacted;
}

/**
 * Redact an array of records for demo mode.
 */
export function redactArrayForDemo(records) {
  if (!records) return records;
  return records.map(redactForDemo);
}

/**
 * Build demo_limits object to include in successful API responses.
 * Returns undefined for full-access users (omitted from JSON).
 */
export function demoLimitsPayload(access) {
  if (!access || access.mode !== "demo") return undefined;
  return {
    hourly_limit: access.hourlyLimit,
    daily_limit: access.dailyLimit,
    hourly_remaining: access.hourlyRemaining,
    daily_remaining: access.dailyRemaining,
  };
}
