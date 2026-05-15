import { createClient } from "@supabase/supabase-js";
import { DirectoryQuery, validate } from "./_validate.js";

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

  const params = validate(DirectoryQuery, req.query, res);
  if (!params) return;

  try {
    const supabase = getSupabase();
    const { page: pageNum, limit: limitNum, type, name, state, sort, order, min_sites } = params;
    const offset = (pageNum - 1) * limitNum;

    if (type === "manufacturer") {
      return await handleManufacturers(supabase, { name, limitNum, offset, min_sites }, res, pageNum);
    }

    if (type === "installer") {
      return await handleInstallers(supabase, { name, state, sort, order, limitNum, offset, min_sites }, res, pageNum);
    }

    if (type === "owner" || type === "developer" || type === "operator") {
      return await handleOwners(supabase, { type, name, state, sort, order, limitNum, offset, min_sites }, res, pageNum);
    }

    // type === "all" — run installer + owner + manufacturer in parallel, merge
    const [installers, owners, manufacturers] = await Promise.all([
      fetchInstallers(supabase, { name, state, limit: 200 }),
      fetchOwners(supabase, { name, state, limit: 200 }),
      fetchManufacturers(supabase, { name, limit: 100 }),
    ]);

    const merged = [...installers, ...owners, ...manufacturers];
    merged.sort((a, b) => {
      if (sort === "name") return order === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      if (sort === "capacity") return order === "asc" ? a.capacity_mw - b.capacity_mw : b.capacity_mw - a.capacity_mw;
      return order === "asc" ? a.site_count - b.site_count : b.site_count - a.site_count;
    });

    const total = merged.length;
    const page_data = merged.slice(offset, offset + limitNum);

    return res.status(200).json({
      data: page_data,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleManufacturers(supabase, { name, limitNum, offset, min_sites }, res, pageNum) {
  const { data, error } = await supabase.rpc("solar_manufacturer_directory", {
    p_name: name || null,
    p_limit: limitNum,
    p_offset: offset,
    p_min_sites: min_sites || 2,
  });
  if (error) return res.status(500).json({ error: error.message });

  const results = (data || []).map(r => ({
    id: null,
    name: r.name,
    role: "manufacturer",
    state: null,
    city: null,
    website: null,
    site_count: Number(r.site_count),
    capacity_mw: 0,
    equipment_count: Number(r.equipment_count),
    equipment_types: r.equipment_types,
  }));

  return res.status(200).json({
    data: results,
    pagination: { page: pageNum, limit: limitNum, total: results.length < limitNum ? offset + results.length : offset + limitNum + 1, totalPages: results.length < limitNum ? pageNum : pageNum + 1 },
  });
}

async function handleInstallers(supabase, { name, state, sort, order, limitNum, offset, min_sites }, res, pageNum) {
  let query = supabase.from("solar_installers").select("*", { count: "estimated" });
  if (name) query = query.ilike("name", `%${name}%`);
  if (state) query = query.eq("state", state);
  if (min_sites) query = query.gte("installation_count", min_sites);

  const sortMap = { name: "name", site_count: "installation_count", capacity: "total_capacity_kw", recent: "last_seen" };
  const sortCol = sortMap[sort] || "installation_count";
  const asc = sort === "name" ? order !== "desc" : order === "asc";

  const { data, error, count } = await query
    .order(sortCol, { ascending: asc, nullsFirst: false })
    .range(offset, offset + limitNum - 1);

  if (error) return res.status(500).json({ error: error.message });

  const results = (data || []).map(r => ({
    id: r.id,
    name: r.name,
    role: "installer",
    state: r.state,
    city: r.city,
    website: r.website,
    phone: r.phone,
    site_count: r.installation_count || 0,
    capacity_mw: r.total_capacity_kw ? r.total_capacity_kw / 1000 : 0,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    rating: r.rating || null,
    review_count: r.review_count || null,
    description: r.description || null,
    avg_project_size_kw: r.avg_project_size_kw || null,
    geographic_focus: r.geographic_focus || null,
  }));

  return res.status(200).json({
    data: results,
    pagination: { page: pageNum, limit: limitNum, total: count || 0, totalPages: Math.ceil((count || 0) / limitNum) },
  });
}

async function handleOwners(supabase, { type, name, state, sort, order, limitNum, offset, min_sites }, res, pageNum) {
  // solar_site_owners has site_count and owned_capacity_mw pre-computed
  let query = supabase.from("solar_site_owners").select("*", { count: "estimated" });
  if (name) query = query.ilike("name", `%${name}%`);
  if (state) query = query.eq("state", state);

  // Filter by entity_type matching the role
  if (type === "owner") query = query.gt("site_count", 0);
  if (type === "developer") query = query.gt("developed_capacity_mw", 0);

  if (min_sites) query = query.gte("site_count", min_sites);

  const sortMap = { name: "name", site_count: "site_count", capacity: "owned_capacity_mw", recent: "updated_at" };
  const sortCol = sortMap[sort] || "site_count";
  const asc = sort === "name" ? order !== "desc" : order === "asc";

  const { data, error, count } = await query
    .order(sortCol, { ascending: asc, nullsFirst: false })
    .range(offset, offset + limitNum - 1);

  if (error) return res.status(500).json({ error: error.message });

  const results = (data || []).map(r => ({
    id: r.id,
    name: r.name,
    role: type,
    state: r.state,
    city: r.city,
    website: r.website,
    phone: r.phone,
    site_count: r.site_count || 0,
    capacity_mw: r.owned_capacity_mw || 0,
    developed_capacity_mw: r.developed_capacity_mw || 0,
    rating: r.rating || null,
    review_count: r.review_count || null,
    description: r.description || null,
    avg_project_size_kw: r.avg_project_size_kw || null,
    geographic_focus: r.geographic_focus || null,
  }));

  return res.status(200).json({
    data: results,
    pagination: { page: pageNum, limit: limitNum, total: count || 0, totalPages: Math.ceil((count || 0) / limitNum) },
  });
}

// Helper fetchers for "all" type
async function fetchInstallers(supabase, { name, state, limit }) {
  let query = supabase.from("solar_installers").select("id, name, state, city, website, installation_count, total_capacity_kw, rating, review_count");
  if (name) query = query.ilike("name", `%${name}%`);
  if (state) query = query.eq("state", state);
  const { data } = await query.order("installation_count", { ascending: false }).limit(limit);
  return (data || []).map(r => ({
    id: r.id, name: r.name, role: "installer", state: r.state, city: r.city, website: r.website,
    site_count: r.installation_count || 0, capacity_mw: r.total_capacity_kw ? r.total_capacity_kw / 1000 : 0,
    rating: r.rating || null, review_count: r.review_count || null,
  }));
}

async function fetchOwners(supabase, { name, state, limit }) {
  let query = supabase.from("solar_site_owners").select("id, name, state, city, website, site_count, owned_capacity_mw, rating, review_count").gt("site_count", 0);
  if (name) query = query.ilike("name", `%${name}%`);
  if (state) query = query.eq("state", state);
  const { data } = await query.order("site_count", { ascending: false }).limit(limit);
  return (data || []).map(r => ({
    id: r.id, name: r.name, role: "owner", state: r.state, city: r.city, website: r.website,
    site_count: r.site_count || 0, capacity_mw: r.owned_capacity_mw || 0,
    rating: r.rating || null, review_count: r.review_count || null,
  }));
}

async function fetchManufacturers(supabase, { name, limit }) {
  const { data } = await supabase.rpc("solar_manufacturer_directory", {
    p_name: name || null, p_limit: limit, p_offset: 0, p_min_sites: 5,
  });
  return (data || []).map(r => ({
    id: null, name: r.name, role: "manufacturer", state: null, city: null, website: null,
    site_count: Number(r.site_count), capacity_mw: 0, equipment_count: Number(r.equipment_count),
  }));
}
