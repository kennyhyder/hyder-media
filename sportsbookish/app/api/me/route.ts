import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TIER_BY_KEY, type TierKey } from "@/lib/tiers";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ user: null });

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("tier, status, current_period_end, cancel_at_period_end, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: prefs } = await supabase
    .from("sb_user_preferences")
    .select("home_book, excluded_books, alert_thresholds, notification_channels, sms_phone")
    .eq("user_id", user.id)
    .maybeSingle();

  const tier = (sub?.tier || "free") as TierKey;
  return NextResponse.json({
    user: { id: user.id, email: user.email },
    subscription: sub,
    preferences: prefs,
    tier_info: TIER_BY_KEY[tier],
  });
}
