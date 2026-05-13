#!/usr/bin/env node
/**
 * Create / update the Stripe webhook endpoint for SportsBookish.
 * Prints the webhook secret you need to add to Vercel env.
 */

import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) { console.error("STRIPE_SECRET_KEY required"); process.exit(1); }
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const URL = process.argv[2] || "https://sportsbookish.com/api/stripe/webhook";

const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

const existing = await stripe.webhookEndpoints.list({ limit: 100 });
let endpoint = existing.data.find((e) => e.url === URL);

if (endpoint) {
  console.log(`Found existing webhook: ${endpoint.id} -> ${endpoint.url}`);
  endpoint = await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: EVENTS });
  console.log("Updated events list.");
} else {
  endpoint = await stripe.webhookEndpoints.create({
    url: URL,
    enabled_events: EVENTS,
    description: "SportsBookish — production",
    metadata: { app: "sportsbookish" },
  });
  console.log(`Created webhook: ${endpoint.id}`);
  console.log(`\nSet this in Vercel env as STRIPE_WEBHOOK_SECRET:`);
  console.log(endpoint.secret);
}

console.log(`\nWebhook URL:       ${endpoint.url}`);
console.log(`Endpoint ID:       ${endpoint.id}`);
console.log(`Status:            ${endpoint.status}`);
console.log(`Listening for:     ${endpoint.enabled_events.join(", ")}`);
