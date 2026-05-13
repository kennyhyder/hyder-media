import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabase
    .from("sb_user_preferences")
    .select("home_book, excluded_books, alert_thresholds, notification_channels, sms_phone")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ preferences: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Check tier — only Pro+ can modify preferences
  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier, status")
    .eq("user_id", user.id)
    .maybeSingle();
  const tier = sub?.tier || "free";
  if (tier === "free") {
    return NextResponse.json({ error: "Upgrade to Pro to customize preferences" }, { status: 403 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("home_book" in body) updates.home_book = body.home_book || null;
  if ("excluded_books" in body) updates.excluded_books = body.excluded_books || [];
  if (tier === "elite") {
    if ("alert_thresholds" in body) updates.alert_thresholds = body.alert_thresholds || {};
    if ("notification_channels" in body) updates.notification_channels = body.notification_channels || ["email"];
    if ("sms_phone" in body) updates.sms_phone = body.sms_phone || null;
  }
  const { error } = await supabase.from("sb_user_preferences").update(updates).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
