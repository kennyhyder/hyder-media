import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { priceIdForTier, type TierKey } from "@/lib/tiers";

// Used right after signup magic-link callback when the user came in via a
// Subscribe button on the pricing page (signup?tier=...). We create the
// checkout session and 302 directly to Stripe — no client round-trip.
export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get("tier") as TierKey | null;
  if (!tier || (tier !== "pro" && tier !== "elite")) {
    return NextResponse.redirect(`${request.nextUrl.origin}/pricing`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${request.nextUrl.origin}/login?next=/pricing`);
  }

  const priceId = priceIdForTier(tier);
  if (!priceId) {
    return NextResponse.redirect(`${request.nextUrl.origin}/pricing?error=no_price`);
  }

  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/dashboard?upgraded=1`,
    cancel_url: `${siteUrl}/pricing?canceled=1`,
    customer: sub?.stripe_customer_id || undefined,
    customer_email: sub?.stripe_customer_id ? undefined : user.email || undefined,
    client_reference_id: user.id,
    metadata: { user_id: user.id, tier },
    subscription_data: { metadata: { user_id: user.id, tier } },
    allow_promotion_codes: true,
  });

  return NextResponse.redirect(session.url!);
}
