"use client";

// Opens the Stripe customer portal (manage / cancel the Pro subscription).

import { useState } from "react";

export default function BillingPortalButton() {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const j = await res.json();
      if (res.ok && j?.url) {
        window.location.href = j.url as string;
        return;
      }
    } catch {
      /* fall through */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-lg border px-3 py-1.5 text-sm font-medium"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    >
      {busy ? "Opening…" : "Manage billing"}
    </button>
  );
}
