// Brand + site-wide constants for GridCensus (gridcensus.com).

export const SITE_NAME = "GridCensus";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://gridcensus.com"
).replace(/\/$/, "");

export const SITE_TAGLINE =
  "Datacenter site selection and speed-to-power intelligence";

export const SITE_DESCRIPTION =
  "GridCensus scores 164,098 candidate datacenter locations across the United States on power availability, speed-to-power, fiber, water, and hazard — turning public infrastructure data into a site-selection screening tool.";

export const CONTACT_EMAIL = "kenny@hyder.me";

export const ORG_LEGAL_NAME = "Hyder Media";
