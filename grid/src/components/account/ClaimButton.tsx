"use client";

// "Claim this profile" CTA for owned entities (datacenter / IXP / company).
// Opens a small inline panel; posts to /api/account/claim. Email-domain match
// auto-verifies a low-trust claim per spec A3.

import { useEffect, useState } from "react";
import type { EntityType } from "@/lib/overrides";
import { authConfigured, hasBrowserSession } from "@/lib/supabase-browser";

const STATUS_LABEL: Record<string, string> = {
  email_verified: "Claim verified by email domain — pending owner edit access.",
  pending: "Claim submitted. We'll verify via website/DNS or manual review.",
};

export default function ClaimButton({
  entityType,
  entityId,
  entityDomain,
}: {
  entityType: EntityType;
  entityId: string;
  entityDomain?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    hasBrowserSession().then((v) => { if (active) setSignedIn(v); });
    return () => { active = false; };
  }, []);

  if (!authConfigured()) return null;

  function onOpen() {
    if (!signedIn) {
      const here = typeof window !== "undefined" ? window.location.pathname : "/";
      window.location.href = `/login?next=${encodeURIComponent(here)}`;
      return;
    }
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          entity_domain: entityDomain ?? undefined,
          claimant_email: email || undefined,
        }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) { setError("Claiming isn't available yet."); return; }
      const data = (await res.json()) as { status: string };
      setResult(STATUS_LABEL[data.status] ?? `Claim status: ${data.status}.`);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--accent)", color: "var(--accent-ink)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
        {result}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 12l2 2 4-4m5.6 1.6A9 9 0 1112 3a9 9 0 018.6 6.6z" />
        </svg>
        Claim this profile
      </button>
    );
  }

  return (
    <div className="surface-card rounded-xl p-4">
      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Claim this profile</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Use a work email at this organization&apos;s domain
        {entityDomain ? ` (${entityDomain})` : ""} to auto-verify. Otherwise
        we&apos;ll verify by DNS or manual review.
      </p>
      <input
        type="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="accent-fill rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "…" : "Submit claim"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: "var(--score-low)" }}>{error}</p>}
    </div>
  );
}
