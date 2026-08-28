"use client";

// "Go Pro" — POSTs /api/stripe/checkout and redirects to Stripe-hosted
// Checkout. Logged-out users go to signup with a return path to /pricing.

import { useState } from "react";

export default function UpgradeButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/signup?next=/pricing";
        return;
      }
      if (res.status === 409) {
        window.location.href = "/account/watchtower";
        return;
      }
      const j = await res.json();
      if (res.ok && j?.url) {
        window.location.href = j.url as string;
        return;
      }
      setMsg("Checkout isn't available right now — email kenny@hyder.me.");
    } catch {
      setMsg("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button type="button" onClick={onClick} disabled={busy} className={className}>
        {busy ? "Opening checkout…" : "Go Pro — $249/mo"}
      </button>
      {msg && <span className="text-center text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
