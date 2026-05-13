import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";

// GET /api/admin/users — every user, joined with their subscription tier.
// Returns: { users: [{ id, email, created_at, last_sign_in_at, tier, status, current_period_end }] }
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const service = createServiceClient();

  // Paginate auth.users in case the list grows
  const all: { id: string; email: string | undefined; created_at: string | undefined; last_sign_in_at: string | undefined }[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    all.push(...(data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    })));
    if ((data.users || []).length < 1000) break;
    page++;
  }

  const ids = all.map((u) => u.id);
  const { data: subs } = await service
    .from("sb_subscriptions")
    .select("user_id, tier, status, current_period_end, stripe_customer_id")
    .in("user_id", ids);
  const subByUser = new Map((subs || []).map((s) => [s.user_id, s]));

  // Redemptions per user
  const { data: reds } = await service
    .from("sb_invite_redemptions")
    .select("user_id, code")
    .in("user_id", ids);
  const codeByUser = new Map<string, string[]>();
  for (const r of reds || []) {
    const arr = codeByUser.get(r.user_id) || [];
    arr.push(r.code);
    codeByUser.set(r.user_id, arr);
  }

  const users = all.map((u) => {
    const sub = subByUser.get(u.id);
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      tier: sub?.tier || "free",
      status: sub?.status || "active",
      current_period_end: sub?.current_period_end || null,
      stripe_customer_id: sub?.stripe_customer_id || null,
      invite_codes: codeByUser.get(u.id) || [],
    };
  });
  users.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return NextResponse.json({ users });
}
