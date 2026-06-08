import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getDailyStats, rollupByBrand } from "@/lib/vault";

export const dynamic = "force-dynamic";

// GET /api/admin/vault/stats?days=30&brands=Polymarket,Kalshi
// Admin-only. Returns raw daily rows + per-brand rollup over the window.
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") || "30");
  const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(365, Math.floor(daysParam))) : 30;
  const brandsParam = url.searchParams.get("brands");
  const brands = brandsParam ? brandsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  try {
    const stats = await getDailyStats({ startDate, endDate, brands });
    const rollup = rollupByBrand(stats);
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
    return NextResponse.json({
      window: { startDate, endDate, days },
      totals,
      rollup,
      daily: stats,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
