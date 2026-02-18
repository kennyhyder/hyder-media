import { createClient } from "@supabase/supabase-js";
import { CompanyQuery, validate } from "./_validate.js";

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

  const { id, name, role } = params;

  if (!id && !name) {
    return res.status(400).json({ error: "Either id or name is required" });
  }

  try {
    const supabase = getSupabase();

    // Get entity base info
    let entity = null;

    if (role === "manufacturer") {
      // Manufacturers don't have a table — use name
      if (!name) return res.status(400).json({ error: "name required for manufacturer" });
      entity = { name, role: "manufacturer" };
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

    // Get portfolio stats from RPC
    const { data: profile, error: profileError } = await supabase.rpc("solar_company_profile", {
      p_id: role === "manufacturer" ? null : (id || entity.id),
      p_name: role === "manufacturer" ? name : null,
      p_role: role,
    });

    if (profileError) return res.status(500).json({ error: profileError.message });

    // For non-manufacturer roles, check cross-roles
    let cross_roles = {};
    if (role !== "manufacturer" && entity.id) {
      const entityId = entity.id;
      const roleChecks = ["owner_id", "operator_id", "developer_id", "installer_id"];
      const fkCol = role === "installer" ? "installer_id" : `${role}_id`;

      const crossPromises = roleChecks
        .filter(col => col !== fkCol)
        .map(async (col) => {
          // For installer entities, check if name appears in owner/operator/developer
          if (role === "installer") {
            // Installers are in a different table, so we check by name match in installations
            const { count } = await supabase
              .from("solar_installations")
              .select("id", { count: "exact", head: true })
              .eq(col, entityId);
            return [col.replace("_id", ""), count || 0];
          }
          // For site_owner entities, check other FK columns
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

    // Format response
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
        site_count: role === "installer" ? (entity.installation_count || profile?.total_sites || 0) : (profile?.total_sites || 0),
        capacity_mw: role === "installer" ? (entity.total_capacity_kw ? entity.total_capacity_kw / 1000 : 0) : (profile?.total_capacity_mw || 0),
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
        // Portfolio data from RPC
        states: profile?.states || [],
        timeline: profile?.timeline || [],
        top_equipment: profile?.top_equipment || [],
        installations: profile?.installations || [],
        // Cross-role appearances
        cross_roles,
      },
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
