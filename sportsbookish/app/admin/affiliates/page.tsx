import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isAdminRequest } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { getMyBrands, getDailyStats, rollupByBrand, type VaultBrand, type VaultBrandRollup } from "@/lib/vault";

export const dynamic = "force-dynamic";

const SITE = "Vault Network · sub-affiliate dashboard mirror";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

export default async function AdminAffiliatesPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/affiliates");
  if (!(await isAdminRequest())) notFound();

  const params = await searchParams;
  const daysParam = Number(params.days || "30");
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(365, Math.floor(daysParam))) : 30;
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  // Fetch in parallel. If the API key is missing or the upstream is down we
  // render a friendly setup card rather than crash the page.
  const [brandsResult, statsResult] = await Promise.allSettled([
    getMyBrands(),
    getDailyStats({ startDate, endDate }),
  ]);
  const brands: VaultBrand[] = brandsResult.status === "fulfilled" ? brandsResult.value : [];
  const errorBrands: string | null =
    brandsResult.status === "rejected"
      ? (brandsResult.reason instanceof Error ? brandsResult.reason.message : String(brandsResult.reason))
      : null;
  const rollup: VaultBrandRollup[] = statsResult.status === "fulfilled" ? rollupByBrand(statsResult.value) : [];
  const errorStats: string | null =
    statsResult.status === "rejected"
      ? (statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason))
      : null;
  const totals = rollup.reduce(
    (acc, r) => {
      acc.clicks += r.clicks;
      acc.registrations += r.registrations;
      acc.ftds += r.ftds;
      acc.qualifications += r.qualifications;
      acc.commission += r.commission;
      return acc;
    },
    { clicks: 0, registrations: 0, ftds: 0, qualifications: 0, commission: 0 },
  );

  const apiKeyMissing = (errorBrands?.includes("VAULT_API_KEY") ?? false) || (errorStats?.includes("VAULT_API_KEY") ?? false);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
          <div className="font-semibold text-sm">🔒 Admin · Affiliates</div>
          <Badge className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/20">{user.email}</Badge>
        </div>
      </header>
      <main className="container mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center gap-1 mb-5 border-b border-border/40">
          <Link href="/admin" className="px-4 py-2 text-sm border-b-2 border-transparent text-muted-foreground hover:text-foreground">Users</Link>
          <Link href="/admin/invites" className="px-4 py-2 text-sm border-b-2 border-transparent text-muted-foreground hover:text-foreground">Invite codes</Link>
          <Link href="/admin/distribute" className="px-4 py-2 text-sm border-b-2 border-transparent text-muted-foreground hover:text-foreground">Distribute</Link>
          <Link href="/admin/affiliates" className="px-4 py-2 text-sm border-b-2 border-emerald-500 text-foreground">Affiliates</Link>
        </div>

        {apiKeyMissing && (
          <Card className="border-amber-500/40 bg-amber-500/5 mb-5">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400">VAULT_API_KEY not set</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Set <code className="text-foreground">VAULT_API_KEY</code> in Vercel (project: sportsbookish) — grab it from the Vault Network dashboard at <a href="https://dashboard.vaultnetwork.io" target="_blank" rel="noopener" className="text-emerald-500">dashboard.vaultnetwork.io</a> → API.</p>
              <pre className="bg-muted/30 p-2 rounded text-xs">printf %s &quot;your-key&quot; | vercel env add VAULT_API_KEY production</pre>
              <p className="text-xs text-muted-foreground">Use <code>printf %s</code> not <code>echo</code> — Vercel CLI bakes trailing newlines into env values and the JSON body equality check then fails.</p>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">{SITE}</h1>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`/admin/affiliates?days=${d}`}
                className={`px-3 py-1 text-xs rounded border ${days === d ? "bg-emerald-600 text-white border-emerald-600" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >
                {d}d
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Clicks</div><div className="text-2xl font-bold">{fmtNum(totals.clicks)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Registrations</div><div className="text-2xl font-bold">{fmtNum(totals.registrations)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">FTDs</div><div className="text-2xl font-bold text-amber-500">{fmtNum(totals.ftds)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Qualified</div><div className="text-2xl font-bold">{fmtNum(totals.qualifications)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Commission</div><div className="text-2xl font-bold text-emerald-500">{fmtUsd(totals.commission)}</div></CardContent></Card>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Performance · {startDate} → {endDate} · {days} days</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {errorStats && !apiKeyMissing && (
              <div className="p-4 text-sm text-rose-400">Vault upstream error: {errorStats}</div>
            )}
            {!errorStats && rollup.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No conversions in the selected window.</div>
            )}
            {rollup.length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 px-3">Brand</th>
                    <th className="text-right p-2">Clicks</th>
                    <th className="text-right p-2">Regs</th>
                    <th className="text-right p-2">FTDs</th>
                    <th className="text-right p-2">Qualified</th>
                    <th className="text-right p-2">Click→Reg</th>
                    <th className="text-right p-2">Reg→FTD</th>
                    <th className="text-right p-2">$ / click</th>
                    <th className="text-right p-2 pr-3">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.map((r) => (
                    <tr key={r.brand} className="border-t border-border/40">
                      <td className="p-2 px-3 font-medium">{r.brand}</td>
                      <td className="text-right p-2">{fmtNum(r.clicks)}</td>
                      <td className="text-right p-2">{fmtNum(r.registrations)}</td>
                      <td className="text-right p-2 text-amber-500">{fmtNum(r.ftds)}</td>
                      <td className="text-right p-2">{fmtNum(r.qualifications)}</td>
                      <td className="text-right p-2 text-muted-foreground">{fmtPct(r.ctr_to_reg)}</td>
                      <td className="text-right p-2 text-muted-foreground">{fmtPct(r.reg_to_ftd)}</td>
                      <td className="text-right p-2 text-muted-foreground">{r.rev_per_click != null ? fmtUsd(r.rev_per_click) : "—"}</td>
                      <td className="text-right p-2 pr-3 font-semibold text-emerald-500">{fmtUsd(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-normal text-muted-foreground">Active offers · {brands.length}</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {errorBrands && !apiKeyMissing && (
              <div className="p-4 text-sm text-rose-400">Vault upstream error: {errorBrands}</div>
            )}
            {!errorBrands && brands.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No brands assigned to your sub-affiliate account yet.</div>
            )}
            {brands.length > 0 && (
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 px-3">Brand</th>
                    <th className="text-right p-2">CPA (split applied)</th>
                    <th className="text-left p-2">States</th>
                    <th className="text-left p-2 pr-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b) => (
                    <tr key={b.brand} className="border-t border-border/40 align-top">
                      <td className="p-2 px-3 font-medium">{b.brand}</td>
                      <td className="text-right p-2 text-emerald-500 font-semibold">{fmtUsd(b.cpa)}</td>
                      <td className="p-2 text-muted-foreground text-xs">{b.states || "—"}</td>
                      <td className="p-2 pr-3 text-muted-foreground text-xs">{b.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground mt-6">
          Source: <a href="https://api.vaultnetwork.io/docs" target="_blank" rel="noopener" className="text-emerald-500">api.vaultnetwork.io</a>{" "}
          · <code>POST /External/MyBrands</code> + <code>POST /External/DailyStats</code> · 10-min server cache.
        </p>
      </main>
    </div>
  );
}
