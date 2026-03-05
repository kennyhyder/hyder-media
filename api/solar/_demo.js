import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

/**
 * Fire-and-forget email alert for demo usage milestones.
 * Never awaited — doesn't slow down API responses.
 */
const ALERT_MILESTONES = [1, 25, 50, 100, 250, 400, 475, 500];

function maybeSendDemoAlert(label, token, lifetimeTotal, lifetimeLimit, eventType) {
  // Check milestone alerts
  let subject, body;

  if (eventType === "limit_hit") {
    subject = `SolarTrack Demo: ${label} hit lifetime limit (${lifetimeLimit} requests)`;
    body = `Demo token "${label}" has reached its lifetime limit of ${lifetimeLimit} requests.\n\nToken: ${token.slice(0, 8)}...\nTotal requests: ${lifetimeTotal}\n\nThey will no longer be able to access the platform with this token.`;
  } else if (eventType === "rate_limit") {
    subject = `SolarTrack Demo: ${label} hit rate limit (${lifetimeTotal} lifetime)`;
    body = `Demo token "${label}" just hit an hourly or daily rate limit.\n\nToken: ${token.slice(0, 8)}...\nLifetime requests so far: ${lifetimeTotal}${lifetimeLimit ? ` / ${lifetimeLimit}` : ""}`;
  } else if (ALERT_MILESTONES.includes(lifetimeTotal)) {
    const pct = lifetimeLimit ? Math.round((lifetimeTotal / lifetimeLimit) * 100) : null;
    const pctStr = pct ? ` (${pct}% of limit)` : "";
    if (lifetimeTotal === 1) {
      subject = `SolarTrack Demo: ${label} just started using the platform`;
      body = `Demo token "${label}" was just used for the first time.\n\nToken: ${token.slice(0, 8)}...\nLifetime limit: ${lifetimeLimit || "none"}`;
    } else {
      subject = `SolarTrack Demo: ${label} — ${lifetimeTotal} requests${pctStr}`;
      body = `Demo token "${label}" has now made ${lifetimeTotal} requests${pctStr}.\n\nToken: ${token.slice(0, 8)}...\nLifetime limit: ${lifetimeLimit || "none"}\nRemaining: ${lifetimeLimit ? lifetimeLimit - lifetimeTotal : "unlimited"}`;
    }
  } else {
    return; // Not a milestone, skip
  }

  // Fire and forget — no await
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
    subject,
    text: body,
  }).catch((err) => console.error("Demo alert email failed:", err.message));
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
  const lifetimeTotal = Number(usage?.[0]?.lifetime_total || 0);
  const lifetimeLimit = tokenRow.lifetime_limit || null;

  const limitsPayload = {
    hourly_limit: tokenRow.hourly_limit, daily_limit: tokenRow.daily_limit,
    hourly_used: hourlyTotal, daily_used: dailyTotal,
    lifetime_limit: lifetimeLimit, lifetime_used: lifetimeTotal,
  };

  // Check lifetime limit (permanent expiry)
  if (lifetimeLimit && lifetimeTotal > lifetimeLimit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "limit_hit");
    res.status(403).json({
      error: "Demo access has expired (lifetime limit reached)",
      contact: "kenny@hyder.me",
      demo_limits: limitsPayload,
    });
    return null;
  }

  if (hourlyTotal > tokenRow.hourly_limit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "rate_limit");
    res.status(429).json({
      error: "Hourly rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "in about an hour",
      demo_limits: limitsPayload,
    });
    return null;
  }

  if (dailyTotal > tokenRow.daily_limit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "rate_limit");
    res.status(429).json({
      error: "Daily rate limit exceeded",
      contact: "kenny@hyder.me",
      retry_after: "tomorrow",
      demo_limits: limitsPayload,
    });
    return null;
  }

  // Send milestone alerts (fire-and-forget)
  maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "milestone");

  return {
    mode: "demo",
    label: tokenRow.label,
    hourlyLimit: tokenRow.hourly_limit,
    dailyLimit: tokenRow.daily_limit,
    dailyRemaining: tokenRow.daily_limit - dailyTotal,
    hourlyRemaining: tokenRow.hourly_limit - hourlyTotal,
    lifetimeLimit: lifetimeLimit,
    lifetimeUsed: lifetimeTotal,
    lifetimeRemaining: lifetimeLimit ? lifetimeLimit - lifetimeTotal : null,
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
    lifetime_limit: access.lifetimeLimit,
    lifetime_remaining: access.lifetimeRemaining,
  };
}
