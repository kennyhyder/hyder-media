"use client";

import { useEffect, useRef } from "react";
import { trackSignUp, trackPurchase } from "@/lib/analytics";

// Reads URL markers set by /auth/callback (?welcome=1) and Stripe checkout
// success_url (?upgraded=1) and fires the matching GA4 event exactly once
// per page load, then scrubs the marker from the address bar so a refresh
// doesn't re-fire. transaction_id (stripe subscription id) is what GA4
// dedupes purchase events on, so even if the marker survived a refresh
// the second event would be deduped server-side.

interface Props {
  // Tier this user currently holds — used as the item_id for purchase events
  // and as a tag on sign_up events so we can segment "signed up to free"
  // vs "signed up directly into a paid plan" in GA4 funnels.
  tier: string;
  // Stripe subscription id, if any. Becomes the transaction_id on purchase.
  // For free signups this can be empty.
  transactionId?: string | null;
}

export default function ConversionTracker({ tier, transactionId }: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const isWelcome = params.get("welcome") === "1";
    const isUpgraded = params.get("upgraded") === "1";
    if (!isWelcome && !isUpgraded) return;

    firedRef.current = true;

    if (isUpgraded) {
      // Paid conversion — fire purchase. We pass the subscription id as
      // transaction_id so GA4 dedupes on it. If we don't have one yet
      // (webhook still processing), use a deterministic fallback so it
      // still tracks; GA4 will dedupe the real one when it lands.
      const txid = transactionId || `${tier}-${Date.now()}`;
      trackPurchase(tier, txid);
    } else if (isWelcome) {
      // Free signup arriving from /auth/callback. Tier will be 'free' here
      // since the Supabase trigger creates the row before this page renders.
      trackSignUp("magic_link", tier);
    }

    // Scrub markers from the URL so a refresh doesn't try to re-fire.
    params.delete("welcome");
    params.delete("upgraded");
    const newQuery = params.toString();
    const newUrl = window.location.pathname + (newQuery ? `?${newQuery}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);
  }, [tier, transactionId]);

  return null;
}
