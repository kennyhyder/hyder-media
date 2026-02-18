export interface Installation {
  id: string;
  site_name: string | null;
  site_type: "commercial" | "utility" | "community";
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  capacity_dc_kw: number | null;
  capacity_ac_kw: number | null;
  capacity_mw: number | null;
  mount_type: string | null;
  tracking_type: string | null;
  num_modules: number | null;
  num_inverters: number | null;
  has_battery_storage: boolean;
  battery_capacity_kwh: number | null;
  owner_id: string | null;
  owner_name: string | null;
  developer_id: string | null;
  developer_name: string | null;
  operator_id: string | null;
  operator_name: string | null;
  installer_id: string | null;
  installer_name: string | null;
  install_date: string | null;
  interconnection_date: string | null;
  permit_date: string | null;
  decommission_date: string | null;
  site_status: "active" | "proposed" | "under_construction" | "retired" | "decommissioned" | "canceled" | "unknown" | "inactive";
  total_cost: number | null;
  cost_per_watt: number | null;
  data_source_id: string | null;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
  equipment?: Equipment[];
  events?: SiteEvent[];
}

export interface Equipment {
  id: string;
  installation_id: string;
  equipment_type:
    | "module"
    | "inverter"
    | "racking"
    | "battery"
    | "transformer"
    | "tracker";
  manufacturer: string | null;
  model: string | null;
  quantity: number;
  module_wattage_w: number | null;
  module_technology: string | null;
  module_efficiency: number | null;
  inverter_capacity_kw: number | null;
  inverter_type: string | null;
  battery_capacity_kwh: number | null;
  battery_chemistry: string | null;
  specs: Record<string, unknown>;
  install_date: string | null;
  warranty_expiry: string | null;
  manufacture_year: number | null;
  equipment_status: "active" | "replaced" | "failed" | "removed";
  data_source_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteOwner {
  id: string;
  name: string;
  normalized_name: string | null;
  entity_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  owned_capacity_mw: number;
  developed_capacity_mw: number;
  site_count: number;
  created_at: string;
  updated_at: string;
}

export interface Installer {
  id: string;
  name: string;
  normalized_name: string | null;
  license_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  installation_count: number;
  total_capacity_kw: number;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteEvent {
  id: string;
  installation_id: string;
  event_type:
    | "repower"
    | "upgrade"
    | "expansion"
    | "damage"
    | "maintenance"
    | "decommission";
  event_date: string | null;
  description: string | null;
  old_capacity_kw: number | null;
  new_capacity_kw: number | null;
  equipment_changed:
    | { type: string; old_model: string; new_model: string }[]
    | null;
  data_source_id: string | null;
  created_at: string;
}

export interface DataSource {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  last_import: string | null;
  record_count: number;
  created_at: string;
}

export interface DirectoryEntity {
  id: string | null;
  name: string;
  role: "installer" | "owner" | "developer" | "operator" | "manufacturer";
  state: string | null;
  city: string | null;
  website: string | null;
  phone?: string | null;
  site_count: number;
  capacity_mw: number;
  equipment_count?: number;
  equipment_types?: string[];
  first_seen?: string | null;
  last_seen?: string | null;
  developed_capacity_mw?: number;
}

export interface CompanyProfile {
  id: string | null;
  name: string;
  role: string;
  state: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  license_number: string | null;
  entity_type: string | null;
  site_count: number;
  capacity_mw: number;
  first_seen: string | null;
  last_seen: string | null;
  states: { state: string; count: number }[];
  timeline: { year: number; count: number }[];
  top_equipment: { name: string; count: number; type?: string }[];
  installations: {
    id: string;
    site_name: string | null;
    state: string | null;
    city: string | null;
    capacity_mw: number | null;
    install_date: string | null;
    site_type: string;
    latitude: number | null;
    longitude: number | null;
  }[];
  cross_roles: Record<string, number>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}
