import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { API_PLAN_BY_KEY, type ApiTierKey } from "@/lib/tiers";
import ApiKeysClient from "./ApiKeysClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "API keys — SportsBookISH",
  description: "Manage your SportsBookISH API keys. Create, rotate, or revoke keys for the /v1 REST API.",
};

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings/api-keys");

  const service = createServiceClient();
  const { data: apiSub } = await service
    .from("sb_api_subscriptions")
    .select("tier, status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const tier: ApiTierKey = (apiSub?.status === "active" || apiSub?.status === "trialing")
    ? ((apiSub?.tier as ApiTierKey) || "free")
    : "free";
  const plan = API_PLAN_BY_KEY[tier];

  const { data: keys } = await service
    .from("sb_api_keys")
    .select("id, name, key_prefix, tier, monthly_quota, status, last_used_at, created_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Per-key monthly usage
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

  const maxKeys = tier === "free" ? 1 : 5;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">Settings</div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{plan.name}</Badge>
        </div>
        <nav className="container mx-auto max-w-3xl px-4 pb-3 flex gap-4 text-sm border-t border-border/30 pt-3">
          <Link href="/settings" className="text-muted-foreground hover:text-foreground">Preferences</Link>
          <Link href="/settings/api-keys" className="font-semibold text-emerald-400">API keys</Link>
        </nav>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>API access</CardTitle>
            <CardDescription>
              {tier === "free"
                ? "You're on the free demo tier (1,000 requests/month shared with all demo users). Subscribe to API for your own 20,000/mo quota."
                : `You're on ${plan.name} — ${plan.monthlyQuota.toLocaleString()} requests/month per key.`}
            </CardDescription>
          </CardHeader>
          {tier === "free" && (
            <CardContent>
              <Link
                href="/pricing#api"
                className="inline-flex items-center gap-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm font-semibold"
              >
                Subscribe — $50/mo or $500/yr →
              </Link>
            </CardContent>
          )}
        </Card>

        <ApiKeysClient
          tier={tier}
          maxKeys={maxKeys}
          initialKeys={(keys || []).map((k) => ({
            id: k.id,
            name: k.name,
            key_prefix: k.key_prefix,
            tier: k.tier as ApiTierKey,
            monthly_quota: k.monthly_quota,
            status: k.status as "active" | "revoked",
            last_used_at: k.last_used_at,
            created_at: k.created_at,
            current_month_usage: usageByKey[k.id] || 0,
          }))}
        />

        <Card>
          <CardHeader>
            <CardTitle>Quick start</CardTitle>
            <CardDescription>Once you have a key, hit any /v1 endpoint with it as a Bearer token.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-background border border-border/60 rounded p-3 text-xs overflow-auto">{`curl https://sportsbookish.com/api/v1/edges?min_edge=0.02 \\
  -H "Authorization: Bearer sbi_live_..."`}</pre>
            <div className="text-xs text-muted-foreground mt-2">
              Full docs at <Link href="/api/docs" className="text-emerald-400 hover:underline">/api/docs</Link> · OpenAPI spec at <Link href="/api/v1/openapi.json" className="text-emerald-400 hover:underline">/api/v1/openapi.json</Link>.
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
