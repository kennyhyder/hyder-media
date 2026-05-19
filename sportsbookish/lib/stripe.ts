import Stripe from "stripe";

export function getStripe() {
  // Trim whitespace from the env var — Vercel CLI env add with `echo` (no -n)
  // leaves a trailing newline in the stored value, which corrupts the
  // Authorization header and produces "connection error, retried 2 times"
  // failures with no useful signal. Defensive trim ensures the SDK never
  // sees a malformed key even if the env value is dirty.
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key);
}
