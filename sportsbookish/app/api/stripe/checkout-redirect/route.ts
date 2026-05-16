import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { priceIdForTier, priceIdForApiTier, type TierKey, type ApiTierKey } from "@/lib/tiers";

type AnyTier = TierKey | ApiTierKey;

function isApiTier(t: AnyTier): t is "api_monthly" | "api_annual" {
  return t === "api_monthly" || t === "api_annual";
}

// Used right after signup magic-link callback when the user came in via a
// Subscribe button on the pricing page (signup?tier=...). We create the
// checkout session and 302 directly to Stripe — no client round-trip.
export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get("tier") as AnyTier | null;
  if (!tier || !["pro", "elite", "api_monthly", "api_annual"].includes(tier)) {
    return NextResponse.redirect(`${request.nextUrl.origin}/pricing`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${request.nextUrl.origin}/login?next=/pricing`);
  }

  const priceId = isApiTier(tier) ? priceIdForApiTier(tier) : priceIdForTier(tier as TierKey);
  if (!priceId) {
    return NextResponse.redirect(`${request.nextUrl.origin}/pricing?error=no_price`);
  }

  // Reuse existing Stripe customer from either subscription if present
  const { data: uiSub } = await supabase
    .from("sb_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: apiSub } = await supabase
    .from("sb_api_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const existingCustomerId = uiSub?.stripe_customer_id || apiSub?.stripe_customer_id || undefined;

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const successUrl = isApiTier(tier)
    ? `${siteUrl}/settings/api-keys?upgraded=1`
    : `${siteUrl}/dashboard?upgraded=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: `${siteUrl}/pricing?canceled=1`,
    customer: existingCustomerId,
    customer_email: existingCustomerId ? undefined : user.email || undefined,
    client_reference_id: user.id,
    metadata: { user_id: user.id, tier },
    subscription_data: { metadata: { user_id: user.id, tier } },
    allow_promotion_codes: true,
  });

  return NextResponse.redirect(session.url!);
}
