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
//
// EVERYTHING is wrapped in one try/catch — supabase calls (which can throw
// "Unexpected end of JSON input" when the auth service returns an empty
// body during edge-network blips), Stripe calls, and the env lookup. Any
// failure surfaces a usable reason= in the URL instead of an opaque 500.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;
  const tier = request.nextUrl.searchParams.get("tier") as AnyTier | null;

  if (!tier || !["pro", "elite", "api_monthly", "api_annual"].includes(tier)) {
    return NextResponse.redirect(`${origin}/pricing`);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw new Error(`auth.getUser: ${authErr.message}`);
    if (!user) {
      return NextResponse.redirect(`${origin}/login?next=/pricing`);
    }

    const priceId = isApiTier(tier) ? priceIdForApiTier(tier) : priceIdForTier(tier as TierKey);
    if (!priceId) {
      return NextResponse.redirect(`${origin}/pricing?error=no_price&tier=${tier}`);
    }

    // Reuse existing Stripe customer from either subscription if present.
    const [uiSubRes, apiSubRes] = await Promise.all([
      supabase.from("sb_subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle(),
      supabase.from("sb_api_subscriptions").select("stripe_customer_id").eq("user_id", user.id).maybeSingle(),
    ]);
    const existingCustomerId = uiSubRes.data?.stripe_customer_id || apiSubRes.data?.stripe_customer_id || undefined;

    const stripe = getStripe();
    // Include tier in the success URL so ConversionTracker can fire the
    // GA4 purchase event with the right value even if Stripe's webhook
    // hasn't reached us yet to update sb_subscriptions (this happens ~every
    // time — the browser redirect lands milliseconds before the webhook).
    const successUrl = isApiTier(tier)
      ? `${siteUrl}/settings/api-keys?upgraded=1&tier=${tier}`
      : `${siteUrl}/dashboard?upgraded=1&tier=${tier}`;

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
    if (!session.url) throw new Error("Stripe returned session without url");
    return NextResponse.redirect(session.url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[checkout-redirect] failed", { tier, error: msg, stack: e instanceof Error ? e.stack : undefined });
    const reason = encodeURIComponent(msg.slice(0, 200));
    return NextResponse.redirect(`${siteUrl}/pricing?error=checkout_failed&reason=${reason}`);
  }
}
