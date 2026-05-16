import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateApiKey, quotaForTier } from "@/lib/api-auth";
import type { ApiTierKey } from "@/lib/tiers";

export const runtime = "nodejs";

// GET /api/keys — list current user's API keys (without plaintext)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const service = createServiceClient();
  const { data: keys, error } = await service
    .from("sb_api_keys")
    .select("id, name, key_prefix, tier, monthly_quota, status, last_used_at, created_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute current-month usage per key in one query
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const keyIds = (keys || []).map((k) => k.id);
  const usageByKey: Record<number, number> = {};
  if (keyIds.length > 0) {
    const { data: usage } = await service
      .from("sb_api_usage")
      .select("api_key_id")
      .in("api_key_id", keyIds)
      .gte("called_at", monthStart.toISOString());
    for (const u of usage || []) {
      usageByKey[u.api_key_id] = (usageByKey[u.api_key_id] || 0) + 1;
    }
  }

  return NextResponse.json({
    keys: (keys || []).map((k) => ({ ...k, current_month_usage: usageByKey[k.id] || 0 })),
  });
}

// POST /api/keys — create a new key. Returns plaintext ONCE.
// Tier is derived from the user's current API subscription (sb_subscriptions).
// Body: { name?: string }
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === "string" && body.name.trim()) || "Untitled key";

  const service = createServiceClient();

  // Look up the user's active API subscription (sb_api_subscriptions table —
  // separate from sb_subscriptions which gates the UI). If none, issue free tier.
  const { data: apiSub } = await service
    .from("sb_api_subscriptions")
    .select("tier, stripe_subscription_id, status")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  const tier: ApiTierKey = (apiSub?.tier as ApiTierKey) || "free";
  const monthlyQuota = quotaForTier(tier);

  // Free users get at most 1 key; paid get up to 5.
  const { count: existing } = await service
    .from("sb_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active");

  const maxKeys = tier === "free" ? 1 : 5;
  if ((existing ?? 0) >= maxKeys) {
    return NextResponse.json(
      { error: `You already have the maximum number of active keys (${maxKeys}). Revoke an existing key first.` },
      { status: 400 }
    );
  }

  const { plaintext, hash, prefix } = generateApiKey();
  const { data: row, error } = await service
    .from("sb_api_keys")
    .insert({
      user_id: user.id,
      name,
      key_hash: hash,
      key_prefix: prefix,
      tier,
      monthly_quota: monthlyQuota,
      stripe_subscription_id: apiSub?.stripe_subscription_id || null,
    })
    .select("id, name, key_prefix, tier, monthly_quota, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ key: { ...row, plaintext } });
}
