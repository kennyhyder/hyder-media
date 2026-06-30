// Operating-company aggregation (Baxtel-style operator profiles).
//
// Read-only: no new tables. We paginate grid_datacenters (operator not null)
// and grid_ixp_facilities (org_name not null), NORMALIZE the raw operator
// strings into canonical company names, group by the normalized name, and emit
// company records with facility lists + footprint stats.
//
// PostgREST aggregates are DISABLED on this project (see db.ts), so all grouping
// happens in JS after a bounded paginated fetch. Operator-bearing datacenters
// (~2.8k) + org-bearing IXP facilities (~1.4k) are small enough to pull whole.

import "server-only";

import { restGet } from "@/lib/db";
import { normalizeCompanyName, companySlug } from "@/lib/company-normalize";

// Re-export the pure helpers so existing call sites can keep importing from here.
export { normalizeCompanyName, companySlug } from "@/lib/company-normalize";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompanyFacility {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  year_built: number | null;
  status: string | null;
  website: string | null;
  kind: "datacenter" | "ixp";
}

export interface Company {
  slug: string;
  name: string;
  facilityCount: number;
  dcCount: number;
  ixpCount: number;
  totalCapacityMw: number;
  totalSqft: number;
  states: string[];
  facilities: CompanyFacility[];
  website: string | null;
  salesEmail: string | null;
  salesPhone: string | null;
}

// ── Raw fetchers (paginated; bounded) ────────────────────────────────────────

interface DcRow {
  id: string;
  name: string | null;
  operator: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity_mw: number | null;
  sqft: number | null;
  dc_type: string | null;
  year_built: number | null;
  status: string | null;
  website: string | null;
  sales_email: string | null;
  sales_phone: string | null;
}

interface IxpRow {
  id: string;
  name: string | null;
  org_name: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
}

const DC_SELECT =
  "id,name,operator,city,state,latitude,longitude,capacity_mw,sqft,dc_type,year_built,status,website,sales_email,sales_phone";
const IXP_SELECT = "id,name,org_name,city,state,latitude,longitude,website";

async function fetchAllOperatorDatacenters(): Promise<DcRow[]> {
  const PAGE = 1000;
  const out: DcRow[] = [];
  for (let offset = 0; offset < 10000; offset += PAGE) {
    const rows = await restGet<DcRow>("grid_datacenters", {
      params: {
        select: DC_SELECT,
        operator: "not.is.null",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchAllOrgIxps(): Promise<IxpRow[]> {
  const PAGE = 1000;
  const out: IxpRow[] = [];
  for (let offset = 0; offset < 6000; offset += PAGE) {
    const rows = await restGet<IxpRow>("grid_ixp_facilities", {
      params: {
        select: IXP_SELECT,
        org_name: "not.is.null",
        order: "id.asc",
      },
      headers: { Range: `${offset}-${offset + PAGE - 1}` },
    });
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

interface Accum {
  slug: string;
  // Vote on the display name: any two normalized names that slugify the same
  // (e.g. "DLI ONE" vs "DLI One", "At&t" vs "AT&T") are the same company, so we
  // group by SLUG and pick the most-frequent display name as canonical.
  nameVotes: Map<string, number>;
  facilities: CompanyFacility[];
  states: Set<string>;
  totalCapacityMw: number;
  totalSqft: number;
  dcCount: number;
  ixpCount: number;
  website: string | null;
  salesEmail: string | null;
  salesPhone: string | null;
}

function buildCompanies(dcs: DcRow[], ixps: IxpRow[]): Company[] {
  const bySlug = new Map<string, Accum>();

  const ensure = (name: string): Accum => {
    const slug = companySlug(name);
    let a = bySlug.get(slug);
    if (!a) {
      a = {
        slug,
        nameVotes: new Map<string, number>(),
        facilities: [],
        states: new Set<string>(),
        totalCapacityMw: 0,
        totalSqft: 0,
        dcCount: 0,
        ixpCount: 0,
        website: null,
        salesEmail: null,
        salesPhone: null,
      };
      bySlug.set(slug, a);
    }
    a.nameVotes.set(name, (a.nameVotes.get(name) ?? 0) + 1);
    return a;
  };

  for (const r of dcs) {
    const name = normalizeCompanyName(r.operator);
    if (!name) continue;
    const a = ensure(name);
    a.dcCount += 1;
    if (r.state) a.states.add(r.state);
    if (typeof r.capacity_mw === "number") a.totalCapacityMw += r.capacity_mw;
    if (typeof r.sqft === "number") a.totalSqft += r.sqft;
    if (!a.website && r.website) a.website = r.website;
    if (!a.salesEmail && r.sales_email) a.salesEmail = r.sales_email;
    if (!a.salesPhone && r.sales_phone) a.salesPhone = r.sales_phone;
    a.facilities.push({
      id: r.id,
      name: r.name,
      city: r.city,
      state: r.state,
      latitude: r.latitude,
      longitude: r.longitude,
      capacity_mw: r.capacity_mw,
      sqft: r.sqft,
      dc_type: r.dc_type,
      year_built: r.year_built,
      status: r.status,
      website: r.website,
      kind: "datacenter",
    });
  }

  for (const r of ixps) {
    const name = normalizeCompanyName(r.org_name);
    if (!name) continue;
    const a = ensure(name);
    a.ixpCount += 1;
    if (r.state) a.states.add(r.state);
    if (!a.website && r.website) a.website = r.website;
    a.facilities.push({
      id: r.id,
      name: r.name,
      city: r.city,
      state: r.state,
      latitude: r.latitude,
      longitude: r.longitude,
      capacity_mw: null,
      sqft: null,
      dc_type: null,
      year_built: null,
      status: null,
      website: r.website,
      kind: "ixp",
    });
  }

  const out: Company[] = [];
  for (const a of bySlug.values()) {
    // Sort facilities: datacenters first, by footprint desc, then IXPs.
    a.facilities.sort((x, y) => {
      if (x.kind !== y.kind) return x.kind === "datacenter" ? -1 : 1;
      const fx = x.sqft ?? x.capacity_mw ?? 0;
      const fy = y.sqft ?? y.capacity_mw ?? 0;
      return fy - fx;
    });
    // Canonical display name = most-voted variant (ties → shortest, then alpha).
    const name = [...a.nameVotes.entries()].sort(
      (x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0])
    )[0][0];
    out.push({
      slug: a.slug,
      name,
      facilityCount: a.facilities.length,
      dcCount: a.dcCount,
      ixpCount: a.ixpCount,
      totalCapacityMw: a.totalCapacityMw,
      totalSqft: a.totalSqft,
      states: Array.from(a.states).sort(),
      facilities: a.facilities,
      website: a.website,
      salesEmail: a.salesEmail,
      salesPhone: a.salesPhone,
    });
  }

  // Most facilities first (hub default ordering).
  out.sort((x, y) => y.facilityCount - x.facilityCount || x.name.localeCompare(y.name));
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** All operating companies (datacenters + IXP operators), normalized + grouped. */
export async function getCompanies(): Promise<Company[]> {
  const [dcs, ixps] = await Promise.all([
    fetchAllOperatorDatacenters(),
    fetchAllOrgIxps(),
  ]);
  return buildCompanies(dcs, ixps);
}

/** Resolve a single company by its normalized slug. */
export async function getCompanyBySlug(slug: string): Promise<Company | null> {
  const companies = await getCompanies();
  return companies.find((c) => c.slug === slug) ?? null;
}
