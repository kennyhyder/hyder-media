// Vault Network affiliate API client.
//
// Surface (per https://api.vaultnetwork.io/swagger/external/swagger.json):
//   POST /External/MyBrands    — brands you're promoting + CPA + states + notes
//   POST /External/DailyStats  — clicks/regs/FTDs/qualifications/commission per
//                                 (brand, region, date) for a date range
//
// Auth: API key in the request body (`apiKey`). No header auth, no OAuth.
// Read from VAULT_API_KEY env (Vercel — set via `vercel env add`). The key
// is defensively `.trim()`'d because `echo | vercel env add` leaves a
// trailing newline that survives equality checks but breaks the JSON body.

const VAULT_BASE = "https://api.vaultnetwork.io";

export interface VaultBrand {
  brand: string;
  states: string;
  cpa: number;
  notes: string;
}

export interface VaultDailyStat {
  brand: string;
  link: string;
  region: string;
  date: string;            // ISO timestamp; date part is the only meaningful slice
  registrations: number;
  ftds: number;            // first-time deposits
  qualifications: number;
  clicks: number;
  commission: number;      // USD, already split-applied per user's contract
}

export interface VaultStatsRange {
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  brands?: string[];       // omit / empty for all
}

function getApiKey(): string {
  const raw = process.env.VAULT_API_KEY;
  if (!raw) throw new Error("VAULT_API_KEY not set");
  return raw.trim();
}

async function vaultPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${VAULT_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiKey: getApiKey(), ...body }),
    // Vault data updates daily; cache server-side for 10 min to ride out
    // dashboard pollers + reload bursts without burning the rate limit.
    next: { revalidate: 600 },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Vault ${path} ${r.status}: ${text.slice(0, 300)}`);
  }
  return (await r.json()) as T;
}

export async function getMyBrands(opts: { namesOnly?: boolean } = {}): Promise<VaultBrand[]> {
  return vaultPost<VaultBrand[]>("/External/MyBrands", { namesOnly: !!opts.namesOnly });
}

export async function getDailyStats(range: VaultStatsRange): Promise<VaultDailyStat[]> {
  return vaultPost<VaultDailyStat[]>("/External/DailyStats", {
    startDate: range.startDate,
    endDate: range.endDate,
    brands: range.brands && range.brands.length ? range.brands : undefined,
  });
}

// Rollup helper for the admin UI — collapses the raw (brand, region, date)
// rows into per-brand totals over the requested window.
export interface VaultBrandRollup {
  brand: string;
  clicks: number;
  registrations: number;
  ftds: number;
  qualifications: number;
  commission: number;
  days: number;
  ctr_to_reg: number | null;
  reg_to_ftd: number | null;
  rev_per_click: number | null;
}

export function rollupByBrand(stats: VaultDailyStat[]): VaultBrandRollup[] {
  const m = new Map<string, VaultBrandRollup>();
  const seenDates = new Map<string, Set<string>>();
  for (const r of stats) {
    let agg = m.get(r.brand);
    if (!agg) {
      agg = {
        brand: r.brand,
        clicks: 0,
        registrations: 0,
        ftds: 0,
        qualifications: 0,
        commission: 0,
        days: 0,
        ctr_to_reg: null,
        reg_to_ftd: null,
        rev_per_click: null,
      };
      m.set(r.brand, agg);
      seenDates.set(r.brand, new Set());
    }
    agg.clicks += r.clicks || 0;
    agg.registrations += r.registrations || 0;
    agg.ftds += r.ftds || 0;
    agg.qualifications += r.qualifications || 0;
    agg.commission += r.commission || 0;
    const dayKey = (r.date || "").slice(0, 10);
    if (dayKey) seenDates.get(r.brand)!.add(dayKey);
  }
  for (const agg of m.values()) {
    agg.days = seenDates.get(agg.brand)!.size;
    agg.ctr_to_reg = agg.clicks > 0 ? agg.registrations / agg.clicks : null;
    agg.reg_to_ftd = agg.registrations > 0 ? agg.ftds / agg.registrations : null;
    agg.rev_per_click = agg.clicks > 0 ? agg.commission / agg.clicks : null;
  }
  return Array.from(m.values()).sort((a, b) => b.commission - a.commission);
}
