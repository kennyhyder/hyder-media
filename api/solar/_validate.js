import { z } from "zod";

// Shared coercions for query params (all come as strings)
const optStr = z.string().optional();
const optInt = z.coerce.number().int().positive().optional();
const optFloat = z.coerce.number().optional();
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional();
const pageInt = z.coerce.number().int().min(1).default(1);
const limitInt = z.coerce.number().int().min(1).max(100).default(50);

export const InstallationsQuery = z.object({
  page: pageInt,
  limit: limitInt,
  sort: z.enum(["install_date", "capacity_dc_kw", "capacity_mw", "state", "site_name", "site_status", "created_at"]).default("install_date"),
  order: z.enum(["asc", "desc"]).default("desc"),
  state: z.string().length(2).toUpperCase().optional(),
  site_type: z.enum(["utility", "commercial", "community"]).optional(),
  site_status: z.enum(["active", "proposed", "under_construction", "retired", "canceled"]).optional(),
  installer: optStr,
  owner: optStr,
  min_size: optFloat,
  max_size: optFloat,
  start_date: optDate,
  end_date: optDate,
  module_manufacturer: optStr,
  has_battery: z.enum(["true", "false"]).optional(),
  near_lat: optFloat,
  near_lng: optFloat,
  radius_miles: optFloat,
  q: optStr,
  deduplicate: z.enum(["true", "false"]).optional(),
});

export const InstallationQuery = z.object({
  id: z.string().uuid("Invalid installation ID"),
});

export const EquipmentQuery = z.object({
  page: pageInt,
  limit: limitInt,
  sort: z.enum(["manufacturer", "model", "equipment_type", "created_at", "capacity_mw", "install_date", "state"]).default("manufacturer"),
  order: z.enum(["asc", "desc"]).default("asc"),
  manufacturer: optStr,
  model: optStr,
  equipment_type: z.enum(["module", "inverter", "battery", "tracker", "racking", "transformer"]).optional(),
  state: z.string().length(2).toUpperCase().optional(),
  status: optStr,
  min_age_years: optInt,
});

export const InstallersQuery = z.object({
  page: pageInt,
  limit: limitInt,
  sort: z.enum(["installation_count", "total_capacity_kw", "name", "last_seen"]).default("installation_count"),
  state: z.string().length(2).toUpperCase().optional(),
  name: optStr,
  min_installations: optInt,
});

export const DirectoryQuery = z.object({
  page: pageInt,
  limit: limitInt,
  type: z.enum(["all", "installer", "owner", "developer", "operator", "manufacturer"]).default("all"),
  name: optStr,
  state: z.string().length(2).toUpperCase().optional(),
  sort: z.enum(["name", "site_count", "capacity", "recent"]).default("site_count"),
  order: z.enum(["asc", "desc"]).default("desc"),
  min_sites: optInt,
});

export const CompanyQuery = z.object({
  id: z.string().uuid("Invalid entity ID").optional(),
  name: optStr,
  role: z.enum(["installer", "owner", "developer", "operator", "manufacturer"]).default("installer"),
});

export const ExportQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50000).default(10000),
  state: z.string().length(2).toUpperCase().optional(),
  site_type: z.enum(["utility", "commercial", "community"]).optional(),
  site_status: z.enum(["active", "proposed", "under_construction", "retired", "canceled"]).optional(),
  installer: optStr,
  owner: optStr,
  min_size: optFloat,
  max_size: optFloat,
  start_date: optDate,
  end_date: optDate,
  module_manufacturer: optStr,
  has_battery: z.enum(["true", "false"]).optional(),
  include_equipment: z.enum(["true", "false"]).optional(),
});

/**
 * Validate query params with a Zod schema. Returns parsed data or sends 400 error.
 * @returns {object|null} Parsed params or null (response already sent)
 */
export function validate(schema, query, res) {
  const result = schema.safeParse(query);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
    res.status(400).json({ error: "Invalid parameters", details: errors });
    return null;
  }
  return result.data;
}
