// Shared navigation model for the app shell. Pure data so both the desktop
// Sidebar and the mobile drawer render identical real <a href> links (SSR).

export interface NavLink {
  href: string;
  label: string;
  /** prefix used for active-state matching */
  match?: string;
}

export interface NavGroup {
  label: string;
  links: NavLink[];
}

// Primary destinations (top of sidebar).
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/map", label: "Map", match: "/map" },
  { href: "/datacenter-sites", label: "Locations", match: "/datacenter-sites" },
  { href: "/site-types", label: "Site Types", match: "/site-types" },
  { href: "/iso", label: "ISO Regions", match: "/iso" },
  { href: "/rankings", label: "Rankings", match: "/rankings" },
];

// Infrastructure group.
export const INFRA_GROUP: NavGroup = {
  label: "Infrastructure",
  links: [
    { href: "/substations", label: "Substations", match: "/substations" },
    { href: "/datacenters", label: "Datacenters", match: "/datacenters" },
    { href: "/companies", label: "Organizations", match: "/companies" },
    { href: "/internet-exchanges", label: "Internet Exchanges", match: "/internet-exchanges" },
    { href: "/brownfield-sites", label: "Brownfields", match: "/brownfield-sites" },
  ],
};

// Footer links (bottom of sidebar, above the theme toggle).
export const FOOTER_LINKS: NavLink[] = [
  { href: "/methodology", label: "Methodology", match: "/methodology" },
  { href: "/pricing", label: "Pricing", match: "/pricing" },
];

// SVG path-d strings for the inline icons (keeps Sidebar server-rendered with
// no icon-library dependency).
export const ICONS: Record<string, string> = {
  map: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 19.382V8.618a1 1 0 00-1.447-.894L15 4m0 13V4m0 0L9 7",
  locations: "M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M12 11a2 2 0 100-4 2 2 0 000 4z",
  types: "M19 11H5m14-7H5m14 14H5m14-4H5",
  iso: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064",
  rankings: "M16 8v8m-4-5v5m-4-2v2m-1 4h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z",
  substations: "M13 10V3L4 14h7v7l9-11h-7z",
  datacenters: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01",
  exchanges: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  companies: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m6-14h.01M9 11h.01M9 15h.01M15 7h.01M15 11h.01M15 15h.01",
  brownfields: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  methodology: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  pricing: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
};
