import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTier } from "@/lib/tier-guard";
import type { AlertRule } from "@/lib/alert-rules";
import AlertRulesPanel from "@/components/alerts/AlertRulesPanel";
import AlertsFeed, { type FeedAlert } from "@/components/alerts/AlertsFeed";

export const dynamic = "force-dynamic";

const DATA_HOST = process.env.GOLFODDS_API_HOST || "https://hyder.me";

async function fetchAllAlerts(): Promise<FeedAlert[]> {
  const r = await fetch(`${DATA_HOST}/api/golfodds/all-alerts?since_hours=72&limit=300`, { next: { revalidate: 30 } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.alerts || [];
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "rules" } = await searchParams;
  const { tier, userId } = await getCurrentTier();
  if (!userId) redirect("/login?next=/alerts");

  if (tier !== "elite") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle>Custom alerts are Elite-only</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>Elite lets you build any number of rules — pick the leagues, alert types, minimum threshold, and channels (email + SMS). The engine matches every fired alert against your rules in real time.</p>
            <div className="flex gap-2 justify-center">
              <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Back</Link>
              <Link href="/pricing" className={`${buttonVariants()} bg-emerald-600 hover:bg-emerald-500 text-white`}>See plans</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const [rulesResult, prefsResult, alerts] = await Promise.all([
    supabase.from("sb_alert_rules").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("sb_user_preferences").select("sms_phone").eq("user_id", userId).maybeSingle(),
    fetchAllAlerts(),
  ]);
  const rules = (rulesResult.data || []) as AlertRule[];
  const hasPhone = !!prefsResult.data?.sms_phone;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">⚡ Live Alerts</div>
          <Badge className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/20">Elite</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-1 mb-5 border-b border-border/40">
          <Link
            href="/alerts?tab=rules"
            className={`px-4 py-2 text-sm border-b-2 ${tab === "rules" ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            My rules ({rules.length})
          </Link>
          <Link
            href="/alerts?tab=feed"
            className={`px-4 py-2 text-sm border-b-2 ${tab === "feed" ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Feed ({alerts.length})
          </Link>
          <Link
            href="/alerts?tab=all"
            className={`px-4 py-2 text-sm border-b-2 ${tab === "all" ? "border-emerald-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            All fired
          </Link>
        </div>

        {tab === "rules" && <AlertRulesPanel initialRules={rules} hasPhone={hasPhone} />}
        {tab === "feed" && <AlertsFeed alerts={alerts} rules={rules} filterByRules />}
        {tab === "all" && <AlertsFeed alerts={alerts} rules={rules} filterByRules={false} />}
      </main>
    </div>
  );
}
