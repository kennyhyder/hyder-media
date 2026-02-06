import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getSupabase();
    const {
      state,
      site_type,
      installer,
      owner,
      min_size,
      max_size,
      start_date,
      end_date,
      module_manufacturer,
      has_battery,
      site_status,
      include_equipment,
      limit = "10000",
    } = req.query;

    const limitNum = Math.min(50000, Math.max(1, parseInt(limit)));

    let query = supabase
      .from("solar_installations")
      .select(
        include_equipment === "true"
          ? `*, equipment:solar_equipment(equipment_type, manufacturer, model, quantity, module_wattage_w, module_technology, inverter_capacity_kw)`
          : "*"
      );

    // Apply same filters as installations endpoint
    if (state) query = query.eq("state", state.toUpperCase());
    if (site_type) query = query.eq("site_type", site_type);
    if (site_status) query = query.eq("site_status", site_status);
    if (installer) query = query.ilike("installer_name", `%${installer}%`);
    if (owner) query = query.ilike("owner_name", `%${owner}%`);
    if (min_size) query = query.gte("capacity_dc_kw", parseFloat(min_size));
    if (max_size) query = query.lte("capacity_dc_kw", parseFloat(max_size));
    if (start_date) query = query.gte("install_date", start_date);
    if (end_date) query = query.lte("install_date", end_date);
    if (has_battery === "true") query = query.eq("has_battery_storage", true);

    const { data, error } = await query
      .order("install_date", { ascending: false })
      .limit(limitNum);

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(200).send("No results");

    // Build CSV
    const installationCols = [
      "site_name", "site_type", "site_status", "address", "city", "state", "zip_code", "county",
      "latitude", "longitude", "location_precision",
      "capacity_dc_kw", "capacity_ac_kw", "capacity_mw",
      "install_date", "interconnection_date", "decommission_date",
      "owner_name", "operator_name", "developer_name", "installer_name",
      "mount_type", "tracking_type", "num_modules", "num_inverters",
      "has_battery_storage", "battery_capacity_kwh", "total_cost", "cost_per_watt",
    ];

    let rows;
    if (include_equipment === "true") {
      // Flatten equipment into rows
      const equipCols = ["equipment_type", "manufacturer", "model", "quantity", "module_wattage_w", "module_technology", "inverter_capacity_kw"];
      const allCols = [...installationCols, ...equipCols];
      const header = allCols.map(c => `"${c}"`).join(",");

      rows = [header];
      for (const inst of data) {
        const equipment = inst.equipment || [];
        if (equipment.length === 0) {
          const row = allCols.map(c => csvValue(inst[c])).join(",");
          rows.push(row);
        } else {
          for (const equip of equipment) {
            const row = allCols.map(c => {
              if (equipCols.includes(c)) return csvValue(equip[c]);
              return csvValue(inst[c]);
            }).join(",");
            rows.push(row);
          }
        }
      }
    } else {
      const header = installationCols.map(c => `"${c}"`).join(",");
      rows = [header];
      for (const inst of data) {
        rows.push(installationCols.map(c => csvValue(inst[c])).join(","));
      }
    }

    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="solar_installations_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function csvValue(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
