#!/usr/bin/env node
/**
 * Creates SportsBookish Stripe Products + Prices via the API.
 * Idempotent — finds existing products by name and reuses; otherwise creates.
 * Prints env-ready output you can paste into Vercel.
 *
 * Usage: STRIPE_SECRET_KEY=sk_xxx node scripts/setup-stripe-products.mjs
 */

import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY env var required");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = [
  // Pro is monthly only ($10/mo)
  { tier: "pro",   name: "SportsBookish Pro",   priceCents: 1000, interval: "month", envName: "STRIPE_PRICE_PRO" },
  // Elite is annual only ($100/yr) — cheaper than Pro on annual basis to push commitment
  { tier: "elite", name: "SportsBookish Elite", priceCents: 10000, interval: "year",  envName: "STRIPE_PRICE_ELITE" },
];

async function findProductByName(name) {
  const products = await stripe.products.list({ limit: 100, active: true });
  return products.data.find((p) => p.name === name) || null;
}

async function ensureProduct(name) {
  const existing = await findProductByName(name);
  if (existing) {
    console.log(`  Found existing product: ${name} (${existing.id})`);
    return existing;
  }
  const created = await stripe.products.create({
    name,
    description: `${name} subscription`,
    metadata: { app: "sportsbookish" },
  });
  console.log(`  Created product: ${name} (${created.id})`);
  return created;
}

async function ensurePrice(productId, priceCents, interval) {
  const prices = await stripe.prices.list({ product: productId, limit: 50, active: true });
  const existing = prices.data.find(
    (p) => p.recurring?.interval === interval && p.unit_amount === priceCents && p.currency === "usd"
  );
  if (existing) {
    console.log(`    Found existing price: $${priceCents / 100}/${interval} (${existing.id})`);
    return existing;
  }
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: priceCents,
    currency: "usd",
    recurring: { interval },
    metadata: { app: "sportsbookish" },
  });
  console.log(`    Created price: $${priceCents / 100}/${interval} (${created.id})`);
  return created;
}

async function main() {
  console.log("=== Setting up SportsBookish Stripe products ===");
  const isTest = process.env.STRIPE_SECRET_KEY.startsWith("sk_test_");
  console.log(`Mode: ${isTest ? "TEST" : "LIVE"}`);
  console.log("");

  const envVars = {};

  for (const plan of PLANS) {
    console.log(`Plan: ${plan.tier}`);
    const product = await ensureProduct(plan.name);
    const price = await ensurePrice(product.id, plan.priceCents, plan.interval);
    envVars[plan.envName] = price.id;
    envVars[`${plan.envName}_PRODUCT`] = product.id;
    console.log("");
  }

  console.log("=== Add these to Vercel env ===");
  for (const [k, v] of Object.entries(envVars)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
