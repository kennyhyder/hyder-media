import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { priceIdForTier, priceIdForApiTier, type TierKey, type ApiTierKey } from "@/lib/tiers";

type AnyTier = TierKey | ApiTierKey;

function resolvePriceId(tier: AnyTier): string | null {
  if (tier === "pro" || tier === "elite") return priceIdForTier(tier);
  if (tier === "api_monthly" || tier === "api_annual") return priceIdForApiTier(tier);
  return null;
}

function isApiTier(tier: AnyTier): tier is "api_monthly" | "api_annual" {
  return tier === "api_monthly" || tier === "api_annual";
}

export async function POST(request: NextRequest) {
  const { tier } = (await request.json()) as { tier: AnyTier };
  if (!tier || !["pro", "elite", "api_monthly", "api_annual"].includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ requires_auth: true });
  }

  const priceId = resolvePriceId(tier);
  if (!priceId) {
    return NextResponse.json({ error: `No price ID configured for ${tier}` }, { status: 500 });
  }

  // Reuse the customer record across UI + API subs — same customer, two subs.
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const successUrl = isApiTier(tier)
    ? `${siteUrl}/settings/api-keys?upgraded=1`
    : `${siteUrl}/dashboard?upgraded=1`;
  const cancelUrl = `${siteUrl}/pricing?canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer: existingCustomerId,
    customer_email: existingCustomerId ? undefined : user.email || undefined,
    client_reference_id: user.id,
    metadata: { user_id: user.id, tier },
    subscription_data: { metadata: { user_id: user.id, tier } },
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: session.url });
}

// Convenience GET endpoint used by the signup → checkout redirect handoff
export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get("tier") as AnyTier | null;
  if (!tier) return NextResponse.json({ error: "tier required" }, { status: 400 });
  return POST(new Request(request.url, { method: "POST", body: JSON.stringify({ tier }), headers: request.headers }) as NextRequest);
}
