import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { isAdminRequest } from "@/lib/admin";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import AdminUserDetail, { type UserDetailData } from "@/components/admin/AdminUserDetail";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isAdminRequest())) notFound();

  const service = createServiceClient();

  // 1. The user we're looking at
  const { data: target } = await service.auth.admin.getUserById(id);
  if (!target?.user) notFound();

  // 2. Subscription + preferences
  const [subRes, prefsRes, redemptionsRes, rulesRes, dispatchesRes] = await Promise.all([
    service.from("sb_subscriptions").select("*").eq("user_id", id).maybeSingle(),
    service.from("sb_user_preferences").select("*").eq("user_id", id).maybeSingle(),
    service.from("sb_invite_redemptions").select("code, tier, redeemed_at").eq("user_id", id).order("redeemed_at", { ascending: false }),
    service.from("sb_alert_rules").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    service.from("sb_alert_dispatches").select("rule_id, alert_source, alert_id, channels, email_status, sms_status, dispatched_at, snapshot").eq("user_id", id).order("dispatched_at", { ascending: false }).limit(50),
  ]);

  const detail: UserDetailData = {
    user: {
      id: target.user.id,
      email: target.user.email || null,
      created_at: target.user.created_at || null,
      last_sign_in_at: target.user.last_sign_in_at || null,
      email_confirmed_at: target.user.email_confirmed_at || null,
      phone: target.user.phone || null,
    },
    subscription: subRes.data || null,
    preferences: prefsRes.data || null,
    redemptions: redemptionsRes.data || [],
    rules: rulesRes.data || [],
    dispatches: dispatchesRes.data || [],
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> All users
          </Link>
          <div className="font-semibold text-sm truncate">🔒 {detail.user.email}</div>
          <Badge className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/20">{user.email}</Badge>
        </div>
      </header>
      <main className="container mx-auto max-w-6xl px-4 py-6">
        <AdminUserDetail data={detail} adminEmail={user.email || ""} />
      </main>
    </div>
  );
}
