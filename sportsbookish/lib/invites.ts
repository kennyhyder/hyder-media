// Server-side helpers for invite-code redemption.
// Always use the service-role client — invite tables are RLS-protected and
// the anon key cannot read them.

import { createServiceClient } from "@/lib/supabase/server";

export interface InviteCode {
  code: string;
  tier: "free" | "pro" | "elite";
  label: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  disabled: boolean;
}

export type InviteValidationResult =
  | { ok: true; invite: InviteCode }
  | { ok: false; reason: "not_found" | "disabled" | "expired" | "exhausted" };

export async function validateInvite(code: string): Promise<InviteValidationResult> {
  if (!code || code.length > 64) return { ok: false, reason: "not_found" };
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("sb_invite_codes")
    .select("code, tier, label, max_uses, uses, expires_at, disabled")
    .eq("code", code)
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "not_found" };
  if (data.disabled) return { ok: false, reason: "disabled" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, reason: "expired" };
  if (data.uses >= data.max_uses) return { ok: false, reason: "exhausted" };
  return { ok: true, invite: data as InviteCode };
}

// Apply an invite to an authenticated user. Idempotent — re-running on the same
// (code, user_id) pair will not double-count or re-upgrade.
export async function redeemInvite(code: string, userId: string): Promise<{ ok: boolean; tier?: string; reason?: string }> {
  const result = await validateInvite(code);
  if (!result.ok) return { ok: false, reason: result.reason };
  const invite = result.invite;
  const supabase = createServiceClient();

  // Already redeemed by this user? Just ensure their tier matches and return ok.
  const { data: existing } = await supabase
    .from("sb_invite_redemptions")
    .select("id")
    .eq("code", code)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Make sure subscription reflects the tier (in case the user later downgraded)
    await supabase.from("sb_subscriptions").upsert(
      { user_id: userId, tier: invite.tier, status: "active" },
      { onConflict: "user_id" }
    );
    return { ok: true, tier: invite.tier };
  }

  // Atomic-ish upgrade: record redemption + bump usage + set tier.
  // (Three statements; not a true transaction but the uniqueness constraint on
  // (code, user_id) prevents double-redemption races.)
  const { error: redemptionErr } = await supabase
    .from("sb_invite_redemptions")
    .insert({ code, user_id: userId, tier: invite.tier });
  if (redemptionErr) {
    if (redemptionErr.code === "23505") {
      // race: another insert beat us. Treat as success.
      return { ok: true, tier: invite.tier };
    }
    return { ok: false, reason: "insert_failed" };
  }

  await supabase
    .from("sb_invite_codes")
    .update({ uses: invite.uses + 1 })
    .eq("code", code);

  await supabase
    .from("sb_subscriptions")
    .upsert(
      {
        user_id: userId,
        tier: invite.tier,
        status: "active",
        // Set period_end far in the future so it doesn't show "renews on…"
        current_period_end: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: "user_id" }
    );

  return { ok: true, tier: invite.tier };
}
