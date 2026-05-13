import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { priceIdForTier, type TierKey } from "@/lib/tiers";

export async function POST(request: NextRequest) {
  const { tier } = (await request.json()) as { tier: TierKey };
  if (!tier || (tier !== "pro" && tier !== "elite")) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Not authed — pricing page will redirect to /signup?tier=...
    return NextResponse.json({ requires_auth: true });
  }

  const priceId = priceIdForTier(tier);
  if (!priceId) {
    return NextResponse.json({ error: `No price ID configured for ${tier}` }, { status: 500 });
  }

  // Look up existing Stripe customer for this user
  const { data: sub } = await supabase
    .from("sb_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;

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

  return NextResponse.json({ url: session.url });
}

// Convenience GET endpoint used by the signup → checkout redirect handoff
export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get("tier") as TierKey | null;
  if (!tier) return NextResponse.json({ error: "tier required" }, { status: 400 });
  // Reuse POST logic
  return POST(new Request(request.url, { method: "POST", body: JSON.stringify({ tier }), headers: request.headers }) as NextRequest);
}
