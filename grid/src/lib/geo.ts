// US geography + taxonomy helpers for pSEO routing.

export function slugify(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface StateInfo {
  code: string;
  name: string;
  slug: string;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export const STATES: StateInfo[] = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name, slug: slugify(name) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const STATE_BY_SLUG = new Map<string, StateInfo>(
  STATES.map((s) => [s.slug, s])
);
const STATE_BY_CODE = new Map<string, StateInfo>(
  STATES.map((s) => [s.code, s])
);

export function stateBySlug(slug: string): StateInfo | undefined {
  return STATE_BY_SLUG.get(slug);
}

export function stateByCode(code: string): StateInfo | undefined {
  return STATE_BY_CODE.get(code);
}

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

/** "Loudoun County" -> "loudoun-county" */
export function countySlug(name: string): string {
  return slugify(name);
}

// ── Site types ──────────────────────────────────────────────────────────────

export interface SiteTypeInfo {
  key: string;
  label: string;
  slug: string;
  blurb: string;
}

export const SITE_TYPES: Record<string, SiteTypeInfo> = {
  greenfield: {
    key: "greenfield",
    label: "Greenfield",
    slug: "greenfield",
    blurb:
      "Undeveloped land with no prior industrial use. Greenfield parcels offer maximum design flexibility and large contiguous footprints, but typically require full utility build-out — the speed-to-power story hinges on proximity to existing transmission.",
  },
  industrial: {
    key: "industrial",
    label: "Industrial",
    slug: "industrial",
    blurb:
      "Land already zoned or used for industrial activity. Industrial sites frequently come with existing power service, road access, and permitting precedent, shortening the path to energized construction.",
  },
  substation: {
    key: "substation",
    label: "Substation-Adjacent",
    slug: "substation",
    blurb:
      "Parcels sited next to existing transmission substations. Co-location with a substation is the single strongest speed-to-power signal — interconnection distance is measured in feet, not miles.",
  },
  mine: {
    key: "mine",
    label: "Former Mine",
    slug: "mine",
    blurb:
      "Decommissioned or active mining land. Mine sites often retain heavy electrical service and water rights from prior operations, and many sit near coal-plant substations now freeing up grid capacity.",
  },
  federal_excess: {
    key: "federal_excess",
    label: "Federal Excess",
    slug: "federal-excess",
    blurb:
      "Surplus federal property released for civilian reuse. Federal excess parcels can carry existing infrastructure and favorable disposition terms, but acquisition timelines vary with the disposing agency.",
  },
  manufacturing: {
    key: "manufacturing",
    label: "Manufacturing",
    slug: "manufacturing",
    blurb:
      "Active or former manufacturing facilities. These sites usually have substantial electrical service, water, and skilled-trades labor pools already in place — strong fundamentals for retrofit-to-datacenter conversion.",
  },
  shovel_ready: {
    key: "shovel_ready",
    label: "Shovel-Ready",
    slug: "shovel-ready",
    blurb:
      "Pre-permitted, pre-graded sites marketed for rapid development. Shovel-ready designation compresses entitlement risk, making these among the fastest paths from acquisition to vertical construction.",
  },
  brownfield: {
    key: "brownfield",
    label: "Brownfield",
    slug: "brownfield",
    blurb:
      "Previously developed land with real or perceived environmental contamination. Brownfields trade remediation overhead for existing utility hookups, infill locations near fiber, and redevelopment incentives.",
  },
  military_brac: {
    key: "military_brac",
    label: "Military BRAC",
    slug: "military-brac",
    blurb:
      "Property released through Base Realignment and Closure. BRAC sites are rare but can offer large secured footprints with robust legacy power and communications infrastructure.",
  },
};

const SITE_TYPE_BY_SLUG = new Map<string, SiteTypeInfo>(
  Object.values(SITE_TYPES).map((t) => [t.slug, t])
);

export function siteTypeBySlug(slug: string): SiteTypeInfo | undefined {
  return SITE_TYPE_BY_SLUG.get(slug);
}

export function siteTypeLabel(key: string): string {
  return SITE_TYPES[key]?.label ?? key;
}

// ── ISO / RTO regions ────────────────────────────────────────────────────────

export interface IsoInfo {
  key: string;
  label: string;
  fullName: string;
  slug: string;
  blurb: string;
  states: string[]; // primary member-state codes
}

export const ISO_REGIONS: Record<string, IsoInfo> = {
  PJM: {
    key: "PJM",
    label: "PJM",
    fullName: "PJM Interconnection",
    slug: "pjm",
    blurb:
      "PJM coordinates the grid across 13 mid-Atlantic and Midwest states. It contains the world's densest datacenter cluster (Northern Virginia's 'Data Center Alley'), and its interconnection queue is the most closely watched speed-to-power constraint in the country.",
    states: ["PA", "VA", "OH", "IL", "MI", "WV", "KY", "NC", "NJ", "MD", "IN", "DE", "DC", "TN"],
  },
  WECC: {
    key: "WECC",
    label: "WECC",
    fullName: "Western Electricity Coordinating Council",
    slug: "wecc",
    blurb:
      "WECC spans the entire western interconnection outside California's ISO, from the Rockies to the Pacific Northwest. Abundant hydro and renewables pair with rapidly growing load and long transmission distances.",
    states: ["WA", "OR", "ID", "MT", "WY", "UT", "CO", "NV", "AZ", "NM"],
  },
  MISO: {
    key: "MISO",
    label: "MISO",
    fullName: "Midcontinent Independent System Operator",
    slug: "miso",
    blurb:
      "MISO runs the grid across 15 central US states. Deep industrial land inventory and competitive power pricing make it an emerging datacenter frontier, though queue timelines have lengthened.",
    states: ["MN", "IA", "WI", "MO", "AR", "LA", "MS", "IN", "MI", "ND", "SD"],
  },
  SPP: {
    key: "SPP",
    label: "SPP",
    fullName: "Southwest Power Pool",
    slug: "spp",
    blurb:
      "SPP coordinates the central plains. Among the windiest grids in North America, it offers some of the lowest energy prices and shortest queues — attractive for power-hungry, latency-tolerant workloads.",
    states: ["KS", "OK", "NE", "SD", "ND", "AR", "NM", "MO"],
  },
  SERC: {
    key: "SERC",
    label: "SERC",
    fullName: "SERC Reliability Corporation",
    slug: "serc",
    blurb:
      "SERC covers much of the Southeast, a region of vertically integrated utilities, aggressive economic-development incentives, and accelerating datacenter recruitment in Georgia, the Carolinas, and Tennessee.",
    states: ["GA", "NC", "SC", "TN", "AL", "MS", "FL", "KY", "VA"],
  },
  ERCOT: {
    key: "ERCOT",
    label: "ERCOT",
    fullName: "Electric Reliability Council of Texas",
    slug: "ercot",
    blurb:
      "ERCOT is the standalone Texas grid. Its connect-and-manage interconnection model offers the fastest path to energization in the country, fueling explosive datacenter and crypto load growth.",
    states: ["TX"],
  },
  CAISO: {
    key: "CAISO",
    label: "CAISO",
    fullName: "California Independent System Operator",
    slug: "caiso",
    blurb:
      "CAISO runs most of California's grid. Silicon Valley demand and aggressive clean-energy goals collide with high power prices and constrained transmission — a premium but challenging market.",
    states: ["CA"],
  },
  "ISO-NE": {
    key: "ISO-NE",
    label: "ISO-NE",
    fullName: "ISO New England",
    slug: "iso-ne",
    blurb:
      "ISO New England coordinates the six-state Northeast. Winter peaking, constrained gas supply, and limited land keep it a niche datacenter market, but proximity to Boston drives latency-sensitive demand.",
    states: ["MA", "CT", "ME", "NH", "RI", "VT"],
  },
  NYISO: {
    key: "NYISO",
    label: "NYISO",
    fullName: "New York Independent System Operator",
    slug: "nyiso",
    blurb:
      "NYISO operates the New York State grid. Upstate hydro and nuclear power pair with downstate latency demand, while transmission congestion between zones shapes where new load can connect.",
    states: ["NY"],
  },
};

const ISO_BY_SLUG = new Map<string, IsoInfo>(
  Object.values(ISO_REGIONS).map((i) => [i.slug, i])
);

export function isoBySlug(slug: string): IsoInfo | undefined {
  return ISO_BY_SLUG.get(slug);
}

export function isoLabel(key: string): string {
  return ISO_REGIONS[key]?.label ?? key;
}

// ── Voltage tiers ────────────────────────────────────────────────────────────

export interface VoltageTier {
  key: string;
  label: string;
}

export const VOLTAGE_TIERS: VoltageTier[] = [
  { key: "765kv-plus", label: "765 kV and above" },
  { key: "500kv", label: "500 kV" },
  { key: "345kv", label: "345 kV" },
  { key: "230kv", label: "230 kV" },
  { key: "138kv", label: "138 kV" },
  { key: "115kv", label: "115 kV" },
  { key: "69-115kv", label: "69–115 kV" },
  { key: "none", label: "No on-site substation" },
];

export function voltageTierLabel(key: string): string {
  return VOLTAGE_TIERS.find((t) => t.key === key)?.label ?? key;
}
