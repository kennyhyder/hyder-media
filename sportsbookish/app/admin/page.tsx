import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isAdminRequest } from "@/lib/admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import AdminUsersTable, { type AdminUserRow } from "@/components/admin/AdminUsersTable";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isAdminRequest())) notFound();

  // Same shape as /api/admin/users — inlined so the initial render has data
  const service = createServiceClient();
  const all: { id: string; email: string | undefined; created_at: string | undefined; last_sign_in_at: string | undefined }[] = [];
  let page = 1;
  for (;;) {
    const { data } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    all.push(...(data?.users || []).map((u) => ({
      id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
    })));
    if ((data?.users || []).length < 1000) break;
    page++;
  }
  const ids = all.map((u) => u.id);
  const [subsResult, redemptionsResult] = await Promise.all([
    service.from("sb_subscriptions").select("user_id, tier, status, current_period_end, stripe_customer_id").in("user_id", ids),
    service.from("sb_invite_redemptions").select("user_id, code, redeemed_at").in("user_id", ids),
  ]);
  const subByUser = new Map((subsResult.data || []).map((s) => [s.user_id, s]));
  const codesByUser = new Map<string, string[]>();
  for (const r of redemptionsResult.data || []) {
    const arr = codesByUser.get(r.user_id) || [];
    arr.push(r.code);
    codesByUser.set(r.user_id, arr);
  }

  const users: AdminUserRow[] = all.map((u) => {
    const sub = subByUser.get(u.id);
    return {
      id: u.id,
      email: u.email || null,
      created_at: u.created_at || null,
      last_sign_in_at: u.last_sign_in_at || null,
      tier: (sub?.tier || "free") as "free" | "pro" | "elite",
      status: sub?.status || "active",
      stripe_customer_id: sub?.stripe_customer_id || null,
      invite_codes: codesByUser.get(u.id) || [],
    };
  }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const eliteCount = users.filter((u) => u.tier === "elite").length;
  const proCount = users.filter((u) => u.tier === "pro").length;
  const freeCount = users.filter((u) => u.tier === "free").length;

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
          <Link href="/admin" className="px-4 py-2 text-sm border-b-2 border-emerald-500 text-foreground">Users ({users.length})</Link>
          <Link href="/admin/invites" className="px-4 py-2 text-sm border-b-2 border-transparent text-muted-foreground hover:text-foreground">Invite codes</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Total</div><div className="text-2xl font-bold">{users.length}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Elite</div><div className="text-2xl font-bold text-amber-500">{eliteCount}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Pro</div><div className="text-2xl font-bold text-emerald-500">{proCount}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Free</div><div className="text-2xl font-bold">{freeCount}</div></CardContent></Card>
        </div>

        <AdminUsersTable initial={users} adminEmail={user.email || ""} />
      </main>
    </div>
  );
}
