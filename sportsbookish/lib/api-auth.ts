// API key authentication + rate limiting for /api/v1/* endpoints.
//
// Keys format: sbi_live_<32 hex chars>  (sbi = SportsBookISH)
// Stored in sb_api_keys as sha256 hash; only the user sees the plaintext once.
//
// Rate limits per tier (monthly):
//   free:     100   (no signup hook; for "try it" docs page)
//   builder:  10000   ($99/mo)
//   business: 100000  ($499/mo)
//   enterprise: custom (set via admin)

import crypto from "crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export type ApiTier = "free" | "builder" | "business" | "enterprise";

export interface ApiKeyContext {
  key_id: number;
  user_id: string;
  tier: ApiTier;
  monthly_quota: number;
}

export const QUOTA_BY_TIER: Record<ApiTier, number> = {
  free: 100,
  builder: 10000,
  business: 100000,
  enterprise: 1000000,
};

function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(16).toString("hex");
  const plaintext = `sbi_live_${random}`;
  return {
    plaintext,
    hash: hashKey(plaintext),
    prefix: plaintext.slice(0, 16),  // sbi_live_xxxxxxxx — shown in dashboard for ID
  };
}

export async function authenticateApiKey(req: Request): Promise<{ ctx: ApiKeyContext | null; error?: string; status?: number }> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(sbi_(?:live|test)_[a-z0-9]{32})$/i);
  if (!match) {
    return { ctx: null, error: "Missing or invalid API key. Pass as: Authorization: Bearer sbi_live_...", status: 401 };
  }
  const plaintext = match[1];
  const hash = hashKey(plaintext);

  const service = createServiceClient();
  const { data: key } = await service
    .from("sb_api_keys")
    .select("id, user_id, tier, monthly_quota, status, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!key || key.status !== "active" || key.revoked_at) {
    return { ctx: null, error: "API key not found or revoked", status: 401 };
  }

  // Monthly quota enforcement — count usage since start of current calendar month UTC
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await service
    .from("sb_api_usage")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", key.id)
    .gte("called_at", monthStart.toISOString());

  if ((count ?? 0) >= key.monthly_quota) {
    return {
      ctx: null,
      error: `Monthly quota of ${key.monthly_quota} requests exceeded. Upgrade at https://sportsbookish.com/pricing#api or contact for enterprise.`,
      status: 429,
    };
  }

  return {
    ctx: {
      key_id: key.id,
      user_id: key.user_id,
      tier: key.tier as ApiTier,
      monthly_quota: key.monthly_quota,
    },
  };
}

// Record one API call against the key's usage. Updates last_used_at + inserts
// usage row. Fire-and-forget — don't block the response on this.
export async function recordApiCall(ctx: ApiKeyContext, endpoint: string, status: number): Promise<void> {
  const service = createServiceClient();
  try {
    await Promise.all([
      service.from("sb_api_usage").insert({ api_key_id: ctx.key_id, endpoint, status_code: status }),
      service.from("sb_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", ctx.key_id),
    ]);
  } catch { /* best-effort */ }
}

// Convenience wrapper — call this at the top of every /api/v1/* handler.
// Returns the auth context if valid, or a NextResponse with the error otherwise.
export async function requireApiKey(req: Request, endpoint: string): Promise<{ ctx: ApiKeyContext } | NextResponse> {
  const { ctx, error, status } = await authenticateApiKey(req);
  if (!ctx) {
    return NextResponse.json(
      { error, docs: "https://sportsbookish.com/api/docs" },
      { status: status || 401 }
    );
  }
  // Fire usage record in background
  recordApiCall(ctx, endpoint, 200).catch(() => {});
  return { ctx };
}
