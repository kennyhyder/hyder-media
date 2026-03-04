import { createClient } from "@supabase/supabase-js";
import { CompanyQuery, validate } from "./_validate.js";
import { checkDemoAccess } from "./_demo.js";

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

  const params = validate(CompanyQuery, req.query, res);
  if (!params) return;

  const access = await checkDemoAccess(req, res);
  if (!access) return;

  const { id, name, role } = params;

  if (!id && !name) {
    return res.status(400).json({ error: "Either id or name is required" });
  }

  try {
    const supabase = getSupabase();

    // --- Phase 1: Get entity base info ---
    let entity = null;

    if (role === "manufacturer") {
      if (!name) return res.status(400).json({ error: "name required for manufacturer" });
      // Look up manufacturer entity for pre-computed data
      const { data: mfgEntity } = await supabase
        .from("solar_manufacturers")
        .select("*")
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
      entity = { name, role: "manufacturer", ...(mfgEntity || {}) };
    } else if (role === "installer") {
      const { data, error } = id
        ? await supabase.from("solar_installers").select("*").eq("id", id).single()
        : await supabase.from("solar_installers").select("*").ilike("name", name).limit(1).single();
      if (error) return res.status(404).json({ error: "Installer not found" });
      entity = { ...data, role: "installer" };
    } else {
      // owner, developer, operator — all in solar_site_owners
      const { data, error } = id
        ? await supabase.from("solar_site_owners").select("*").eq("id", id).single()
        : await supabase.from("solar_site_owners").select("*").ilike("name", name).limit(1).single();
      if (error) return res.status(404).json({ error: `${role} not found` });
      entity = { ...data, role };
    }

    // --- Phase 2: Get portfolio data (replaces RPC) ---
    let installations = [];
    let top_equipment = [];

    if (role === "manufacturer") {
      // Manufacturer path: query through equipment table
      const { data: eqData } = await supabase
        .from("solar_equipment")
        .select("installation_id, model, equipment_type")
        .ilike("manufacturer", name)
        .limit(2000);

      // Aggregate models in JS
      const modelMap = {};
      const instIdSet = new Set();
      (eqData || []).forEach(eq => {
        instIdSet.add(eq.installation_id);
        const key = eq.model || "(Unknown model)";
        if (!modelMap[key]) modelMap[key] = { name: key, count: 0, type: eq.equipment_type };
        modelMap[key].count++;
      });
      top_equipment = Object.values(modelMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      // Fetch installations for table + charts (sample from equipment results)
      const sampleIds = [...instIdSet].slice(0, 200);
      if (sampleIds.length > 0) {
        const { data: instData } = await supabase
          .from("solar_installations")
          .select("id, site_name, state, city, capacity_mw, install_date, site_type, latitude, longitude")
          .in("id", sampleIds)
          .order("install_date", { ascending: false, nullsFirst: false });
        installations = instData || [];
      }
    } else {
      // Non-manufacturer path: direct FK query (indexed, fast)
      const fkCol = role === "installer" ? "installer_id" : `${role}_id`;
      const entityId = id || entity.id;

      const { data: instData } = await supabase
        .from("solar_installations")
        .select("id, site_name, state, city, capacity_mw, install_date, site_type, latitude, longitude")
        .eq(fkCol, entityId)
        .order("install_date", { ascending: false, nullsFirst: false })
        .limit(200);
      installations = instData || [];

      // Top equipment brands from sample installations
      if (installations.length > 0) {
        const sampleIds = installations.slice(0, 100).map(i => i.id);
        const { data: eqData } = await supabase
          .from("solar_equipment")
          .select("manufacturer, equipment_type")
          .in("installation_id", sampleIds)
          .not("manufacturer", "is", null)
          .limit(1000);

        const brandMap = {};
        (eqData || []).forEach(eq => {
          if (!brandMap[eq.manufacturer]) brandMap[eq.manufacturer] = { name: eq.manufacturer, count: 0 };
          brandMap[eq.manufacturer].count++;
        });
        top_equipment = Object.values(brandMap)
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);
      }
    }

    // --- Derive states and timeline from installations ---
    const stateMap = {};
    installations.forEach(inst => {
      if (inst.state) stateMap[inst.state] = (stateMap[inst.state] || 0) + 1;
    });
    const states = Object.entries(stateMap)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const yearMap = {};
    installations.forEach(inst => {
      const y = inst.install_date?.substring(0, 4);
      if (y && !isNaN(parseInt(y))) yearMap[y] = (yearMap[y] || 0) + 1;
    });
    const timeline = Object.entries(yearMap)
      .map(([year, count]) => ({ year: parseInt(year), count }))
      .sort((a, b) => a.year - b.year);

    // --- Phase 3: Cross-role check (non-manufacturer only) ---
    let cross_roles = {};
    if (role !== "manufacturer" && entity.id) {
      const entityId = entity.id;
      const roleChecks = ["owner_id", "operator_id", "developer_id", "installer_id"];
      const fkCol = role === "installer" ? "installer_id" : `${role}_id`;

      const crossPromises = roleChecks
        .filter(col => col !== fkCol)
        .map(async (col) => {
          const { count } = await supabase
            .from("solar_installations")
            .select("id", { count: "exact", head: true })
            .eq(col, entityId);
          return [col.replace("_id", ""), count || 0];
        });

      const crossResults = await Promise.all(crossPromises);
      for (const [r, count] of crossResults) {
        if (count > 0) cross_roles[r] = count;
      }
    }

    // --- Compute site_count and capacity_mw from entity data ---
    let site_count = 0;
    let capacity_mw = 0;

    if (role === "installer") {
      site_count = entity.installation_count || installations.length;
      capacity_mw = entity.total_capacity_kw ? entity.total_capacity_kw / 1000 : 0;
    } else if (role === "manufacturer") {
      site_count = entity.equipment_count || installations.length;
      capacity_mw = installations.reduce((sum, i) => sum + (Number(i.capacity_mw) || 0), 0);
    } else {
      // owner, developer, operator
      site_count = entity.site_count || installations.length;
      capacity_mw = entity.owned_capacity_mw || entity.developed_capacity_mw || 0;
    }

    // --- Format response ---
    const response = {
      data: {
        id: entity.id || null,
        name: entity.name,
        role: entity.role,
        state: entity.state || null,
        city: entity.city || null,
        website: entity.website || null,
        phone: entity.phone || null,
        license_number: entity.license_number || null,
        entity_type: entity.entity_type || null,
        // Stats
        site_count,
        capacity_mw,
        first_seen: entity.first_seen || null,
        last_seen: entity.last_seen || null,
        // Enrichment data
        rating: entity.rating || null,
        review_count: entity.review_count || null,
        description: entity.description || null,
        business_status: entity.business_status || null,
        avg_project_size_kw: entity.avg_project_size_kw ? Number(entity.avg_project_size_kw) : null,
        primary_equipment_brands: entity.primary_equipment_brands || null,
        geographic_focus: entity.geographic_focus || null,
        project_type_distribution: entity.project_type_distribution || null,
        // Portfolio data
        states,
        timeline,
        top_equipment,
        installations: installations.slice(0, 100),
        // Cross-role appearances
        cross_roles,
      },
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
