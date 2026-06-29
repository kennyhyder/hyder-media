/**
 * Demo-token gating + per-IP rate limiting for GridCensus data API route handlers.
 *
 * Ported from api/grid/_demo.js. The (req,res) flow is replaced with a return
 * union: checkDemoAccess() returns EITHER a DemoAccess object (proceed) OR a
 * NextResponse (short-circuit — caller returns it immediately). All security
 * behavior is preserved exactly:
 *  - anonymous (no-token) full-mode access with best-effort per-IP hourly cap
 *    via the increment_ip_usage RPC, FAILING OPEN on any error.
 *  - demo-token validation, expiry, lifetime + hourly + daily limits.
 *  - generic 503 when usage tracking RPC fails.
 *  - fire-and-forget milestone / limit / rate-limit email alerts.
 */
import { NextResponse } from "next/server";
import { getSupabase } from "./db";
import { CORS_HEADERS } from "./utils";

export interface DemoAccess {
  mode: "full" | "demo";
  label?: string;
  hourlyLimit?: number;
  dailyLimit?: number;
  dailyRemaining?: number;
  hourlyRemaining?: number;
  lifetimeLimit?: number | null;
  lifetimeUsed?: number;
  lifetimeRemaining?: number | null;
}

export interface DemoLimitsPayload {
  hourly_limit?: number;
  daily_limit?: number;
  hourly_remaining?: number;
  daily_remaining?: number;
  lifetime_limit?: number | null;
  lifetime_remaining?: number | null;
}

/**
 * Fire-and-forget email alert for demo usage milestones.
 * Never awaited — doesn't slow down API responses. nodemailer is dynamically
 * imported so the route bundle doesn't hard-depend on it; if it (or the email
 * env vars) is unavailable, the alert is silently skipped.
 */
const ALERT_MILESTONES = [1, 25, 50, 100, 250, 400, 475, 500];

function maybeSendDemoAlert(
  label: string,
  token: string,
  lifetimeTotal: number,
  lifetimeLimit: number | null,
  eventType: "limit_hit" | "rate_limit" | "milestone"
): void {
  let subject: string | undefined;
  let body: string | undefined;

  if (eventType === "limit_hit") {
    subject = `GridScout Demo: ${label} hit lifetime limit (${lifetimeLimit} requests)`;
    body = `Demo token "${label}" has reached its lifetime limit of ${lifetimeLimit} requests.\n\nToken: ${token.slice(0, 8)}...\nTotal requests: ${lifetimeTotal}\n\nThey will no longer be able to access the platform with this token.`;
  } else if (eventType === "rate_limit") {
    subject = `GridScout Demo: ${label} hit rate limit (${lifetimeTotal} lifetime)`;
    body = `Demo token "${label}" just hit an hourly or daily rate limit.\n\nToken: ${token.slice(0, 8)}...\nLifetime requests so far: ${lifetimeTotal}${lifetimeLimit ? ` / ${lifetimeLimit}` : ""}`;
  } else if (ALERT_MILESTONES.includes(lifetimeTotal)) {
    const pct = lifetimeLimit ? Math.round((lifetimeTotal / lifetimeLimit) * 100) : null;
    const pctStr = pct ? ` (${pct}% of limit)` : "";
    if (lifetimeTotal === 1) {
      subject = `GridScout Demo: ${label} just started using the platform`;
      body = `Demo token "${label}" was just used for the first time.\n\nToken: ${token.slice(0, 8)}...\nLifetime limit: ${lifetimeLimit || "none"}`;
    } else {
      subject = `GridScout Demo: ${label} — ${lifetimeTotal} requests${pctStr}`;
      body = `Demo token "${label}" has now made ${lifetimeTotal} requests${pctStr}.\n\nToken: ${token.slice(0, 8)}...\nLifetime limit: ${lifetimeLimit || "none"}\nRemaining: ${lifetimeLimit ? lifetimeLimit - lifetimeTotal : "unlimited"}`;
    }
  } else {
    return;
  }

  // Dynamic import so the build doesn't require nodemailer to be installed.
  // Fire-and-forget; any failure is logged and swallowed.
  void (async () => {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
      // Untyped dynamic import — nodemailer has no bundled types and is only
      // present in the monorepo root, so don't hard-depend on it at build time.
      // Build the specifier at runtime so tsc doesn't resolve the module type.
      type NM = { createTransport: (opts: unknown) => { sendMail: (m: unknown) => Promise<unknown> } };
      const specifier = "nodemailer";
      const mod = await (import(/* webpackIgnore: true */ specifier).catch(() => null)) as
        | ({ default?: NM } & Partial<NM>)
        | null;
      const nodemailer = mod?.default ?? (mod as NM | null);
      if (!nodemailer?.createTransport) return;
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
        subject,
        text: body,
      });
    } catch (err) {
      console.error(
        "GridScout demo alert email failed:",
        (err as Error)?.message || err
      );
    }
  })();
}

// C2: anonymous (no-token) full-mode requests are otherwise unthrottled. Best-effort
// per-IP hourly cap to blunt bulk dataset exfiltration. FAILS OPEN if the RPC/table
// don't exist yet (migration in api/grid/rate-limit.sql is owner-applied).
const ANON_IP_HOURLY_CAP = 120;

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Best-effort per-IP throttle for the anonymous full-mode path.
 * Returns true if the request is OVER the cap (caller should 429), false otherwise.
 * Fails open: any RPC error (incl. "function does not exist" pre-migration) → allow.
 */
async function isAnonIpOverLimit(request: Request): Promise<boolean> {
  try {
    const ip = getClientIp(request);
    if (!ip || ip === "unknown") return false; // can't key it — allow
    const supabase = getSupabase();
    const { data: count, error } = await supabase.rpc("increment_ip_usage", {
      p_ip: ip,
      p_window_minutes: 60,
    });
    if (error) {
      console.error(
        "GridScout anon IP rate-limit RPC error (failing open):",
        error.message
      );
      return false;
    }
    return Number(count) > ANON_IP_HOURLY_CAP;
  } catch (err) {
    console.error(
      "GridScout anon IP rate-limit exception (failing open):",
      (err as Error)?.message || err
    );
    return false;
  }
}

/** Extract the demo token from ?demo_token= or an Authorization: Bearer header. */
export function getDemoToken(
  params: URLSearchParams,
  request: Request
): string | null {
  const qp = params.get("demo_token");
  if (qp) return qp;
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/** True when the caller is anonymous full-mode (no demo_token, no auth header). */
export function isAnonRequest(
  access: DemoAccess,
  params: URLSearchParams,
  request: Request
): boolean {
  return (
    access.mode === "full" &&
    !params.get("demo_token") &&
    !request.headers.get("authorization")
  );
}

type DemoResult = { access: DemoAccess } | { response: NextResponse };

function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

/**
 * Check demo access for a GridCensus API request.
 * Returns { access } to proceed, or { response } to short-circuit (401/429/403/503).
 */
export async function checkDemoAccess(
  request: Request,
  params: URLSearchParams
): Promise<DemoResult> {
  const token = getDemoToken(params, request);

  // No token = anonymous full-mode access. Apply best-effort per-IP throttle (C2).
  if (!token) {
    const overLimit = await isAnonIpOverLimit(request);
    if (overLimit) {
      return {
        response: jsonResponse(
          {
            error: "Rate limit exceeded. Please slow down or request a demo token.",
            contact: "kenny@hyder.me",
            retry_after: "in about an hour",
          },
          429
        ),
      };
    }
    return { access: { mode: "full" } };
  }

  const supabase = getSupabase();

  // Validate token
  const { data: tokenRow, error } = await supabase
    .from("grid_demo_tokens")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .single();

  if (error || !tokenRow) {
    return { response: jsonResponse({ error: "Invalid or inactive demo token" }, 401) };
  }

  // Check expiry
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
    return {
      response: jsonResponse(
        { error: "Demo token has expired", contact: "kenny@hyder.me" },
        401
      ),
    };
  }

  // Increment usage and check rate limits
  const { data: usage, error: usageError } = await supabase.rpc(
    "increment_grid_demo_usage",
    { p_token: token }
  );

  if (usageError) {
    console.error("GridScout demo usage tracking error:", usageError.message);
    return {
      response: jsonResponse(
        { error: "Demo access temporarily unavailable", contact: "kenny@hyder.me" },
        503
      ),
    };
  }

  const dailyTotal = usage?.[0]?.daily_total || 0;
  const hourlyTotal = usage?.[0]?.hourly_total || 0;
  const lifetimeTotal = Number(usage?.[0]?.lifetime_total || 0);
  const lifetimeLimit = tokenRow.lifetime_limit || null;

  const limitsPayload = {
    hourly_limit: tokenRow.hourly_limit,
    daily_limit: tokenRow.daily_limit,
    hourly_used: hourlyTotal,
    daily_used: dailyTotal,
    lifetime_limit: lifetimeLimit,
    lifetime_used: lifetimeTotal,
  };

  // Check lifetime limit
  if (lifetimeLimit && lifetimeTotal > lifetimeLimit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "limit_hit");
    return {
      response: jsonResponse(
        {
          error: "Demo access has expired (lifetime limit reached)",
          contact: "kenny@hyder.me",
          demo_limits: limitsPayload,
        },
        403
      ),
    };
  }

  if (hourlyTotal > tokenRow.hourly_limit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "rate_limit");
    return {
      response: jsonResponse(
        {
          error: "Hourly rate limit exceeded",
          contact: "kenny@hyder.me",
          retry_after: "in about an hour",
          demo_limits: limitsPayload,
        },
        429
      ),
    };
  }

  if (dailyTotal > tokenRow.daily_limit) {
    maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "rate_limit");
    return {
      response: jsonResponse(
        {
          error: "Daily rate limit exceeded",
          contact: "kenny@hyder.me",
          retry_after: "tomorrow",
          demo_limits: limitsPayload,
        },
        429
      ),
    };
  }

  // Send milestone alerts (fire-and-forget)
  maybeSendDemoAlert(tokenRow.label, token, lifetimeTotal, lifetimeLimit, "milestone");

  return {
    access: {
      mode: "demo",
      label: tokenRow.label,
      hourlyLimit: tokenRow.hourly_limit,
      dailyLimit: tokenRow.daily_limit,
      dailyRemaining: tokenRow.daily_limit - dailyTotal,
      hourlyRemaining: tokenRow.hourly_limit - hourlyTotal,
      lifetimeLimit: lifetimeLimit,
      lifetimeUsed: lifetimeTotal,
      lifetimeRemaining: lifetimeLimit ? lifetimeLimit - lifetimeTotal : null,
    },
  };
}

/**
 * Build demo_limits object to include in successful API responses.
 * Returns undefined for full-access users (omitted from JSON).
 */
export function demoLimitsPayload(access: DemoAccess): DemoLimitsPayload | undefined {
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
