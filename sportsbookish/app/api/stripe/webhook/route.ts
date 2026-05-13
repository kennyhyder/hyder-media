import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { tierFromPriceId } from "@/lib/tiers";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "missing signature or secret" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Stripe v22: current_period_start/end live on SubscriptionItem, not Subscription.
  // Pull the first item's period (same for all items on a single-product sub).
  function periodOf(sub: Stripe.Subscription) {
    const item = sub.items.data[0];
    return {
      start: item?.current_period_start ? new Date(item.current_period_start * 1000).toISOString() : null,
      end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.user_id;
        const subscriptionId = session.subscription as string | null;
        const customerId = session.customer as string | null;
        if (userId && subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price?.id || null;
          const tier = tierFromPriceId(priceId);
          const period = periodOf(subscription);
          await supabase.from("sb_subscriptions").upsert({
            user_id: userId,
            tier,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            stripe_price_id: priceId,
            status: subscription.status,
            current_period_start: period.start,
            current_period_end: period.end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;
        const priceId = subscription.items.data[0]?.price?.id || null;
        const tier = tierFromPriceId(priceId);
        const period = periodOf(subscription);
        if (userId) {
          await supabase.from("sb_subscriptions").upsert({
            user_id: userId,
            tier,
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            status: subscription.status,
            current_period_start: period.start,
            current_period_end: period.end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;
        if (userId) {
          await supabase
            .from("sb_subscriptions")
            .update({ tier: "free", status: "canceled", canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("user_id", userId);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const meta = (invoice as unknown as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata;
        const userId = (meta?.user_id || invoice.metadata?.user_id) as string | undefined;
        if (userId) {
          await supabase.from("sb_billing_history").upsert({
            user_id: userId,
            stripe_invoice_id: invoice.id,
            amount_cents: invoice.amount_paid,
            currency: invoice.currency,
            status: "paid",
            period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
            period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
            invoice_pdf_url: invoice.invoice_pdf,
            hosted_invoice_url: invoice.hosted_invoice_url,
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const meta = (invoice as unknown as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata;
        const userId = (meta?.user_id || invoice.metadata?.user_id) as string | undefined;
        if (userId) {
          await supabase.from("sb_billing_history").upsert({
            user_id: userId,
            stripe_invoice_id: invoice.id,
            amount_cents: invoice.amount_due,
            currency: invoice.currency,
            status: "failed",
          });
        }
        break;
      }
    }
  } catch (e) {
    console.error("webhook handler error:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
