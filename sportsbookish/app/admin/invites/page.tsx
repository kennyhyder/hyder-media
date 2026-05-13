import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isAdminRequest } from "@/lib/admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import AdminInvitesPanel, { type InviteCodeRow, type RedemptionRow } from "@/components/admin/AdminInvitesPanel";

export const dynamic = "force-dynamic";

export default async function AdminInvitesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/invites");
  if (!(await isAdminRequest())) notFound();

  const service = createServiceClient();
  const [codesResult, redemptionsResult] = await Promise.all([
    service.from("sb_invite_codes").select("code, tier, label, max_uses, uses, expires_at, disabled, created_at").order("created_at", { ascending: false }),
    service.from("sb_invite_redemptions").select("code, user_id, tier, redeemed_at").order("redeemed_at", { ascending: false }),
  ]);
  const codes = (codesResult.data || []) as InviteCodeRow[];

  // Look up emails for redemption rows
  const userIds = Array.from(new Set((redemptionsResult.data || []).map((r) => r.user_id)));
  const emailByUser = new Map<string, string>();
  if (userIds.length) {
    const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users?.users || []) if (u.email) emailByUser.set(u.id, u.email);
  }
  const redemptions: RedemptionRow[] = (redemptionsResult.data || []).map((r) => ({
    code: r.code,
    user_id: r.user_id,
    email: emailByUser.get(r.user_id) || null,
    tier: r.tier,
    redeemed_at: r.redeemed_at,
  }));

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">🔒 Admin</div>
          <Badge className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/20">{user.email}</Badge>
        </div>
      </header>
      <main className="container mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-1 mb-5 border-b border-border/40">
          <Link href="/admin" className="px-4 py-2 text-sm border-b-2 border-transparent text-muted-foreground hover:text-foreground">Users</Link>
          <Link href="/admin/invites" className="px-4 py-2 text-sm border-b-2 border-emerald-500 text-foreground">Invite codes ({codes.length})</Link>
        </div>

        <AdminInvitesPanel initialCodes={codes} redemptions={redemptions} />
      </main>
    </div>
  );
}
