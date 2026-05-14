import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET  /api/watchlist           — return current user's watchlist
// POST /api/watchlist           — add an item { kind, ref_id, label, league, source? }
// DELETE /api/watchlist?id=N    — remove by id

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { user, supabase };
}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const { data, error } = await supabase
    .from("sb_watchlist")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { kind, ref_id, label, league, source = "sports" } = body;
  if (!kind || !ref_id || !label) {
    return NextResponse.json({ error: "kind, ref_id, label required" }, { status: 400 });
  }
  if (!["team", "player", "event", "tournament"].includes(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sb_watchlist")
    .upsert({ user_id: user.id, kind, ref_id, label, league: league || null, source }, { onConflict: "user_id,kind,ref_id,source" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const ref_id = url.searchParams.get("ref_id");

  let query = supabase.from("sb_watchlist").delete().eq("user_id", user.id);
  if (id) query = query.eq("id", id);
  else if (ref_id) query = query.eq("ref_id", ref_id);
  else return NextResponse.json({ error: "id or ref_id required" }, { status: 400 });

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
