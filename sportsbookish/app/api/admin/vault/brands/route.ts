import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getMyBrands } from "@/lib/vault";

export const dynamic = "force-dynamic";

// GET /api/admin/vault/brands — list active Vault brands + CPA + states + notes.
// Admin-only. Used by /admin/affiliates to render the offer catalog and to
// keep the on-site Polymarket promo CPA in sync with the dashboard.
export async function GET(_req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  try {
    const brands = await getMyBrands();
    return NextResponse.json({ brands, fetched_at: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
