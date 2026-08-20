"use client";

// Email-first lead capture. Three variants:
//   watch  — "Track this site, get alerts" (on entity pages; highest intent)
//   access — "Request full data / API access" (home/pricing; the money leads)
//   export — "Enter email to download the dataset" (export gate)
// Posts to /api/grid/lead. Never gates the free content — this is additive value.

import { useState } from "react";

type Variant = "watch" | "access" | "export";

const COPY: Record<Variant, { eyebrow: string; heading: (n?: string) => string; sub: string; placeholder: string; cta: string; criteria?: string }> = {
  watch: {
    eyebrow: "Get alerts",
    heading: (n) => (n ? `Track ${n}` : "Track this site"),
    sub: "Get an email when its DC-readiness score, available capacity, or interconnection-queue status changes.",
    placeholder: "you@company.com",
    cta: "Notify me",
    criteria: "Markets you're tracking (optional)",
  },
  access: {
    eyebrow: "Full access",
    heading: () => "Get the full GridCensus dataset",
    sub: "Bulk data, API access, and custom site-selection support across all 147,000 scored sites. Tell us what you're building.",
    placeholder: "you@company.com",
    cta: "Request access",
    criteria: "What you're evaluating (optional)",
  },
  export: {
    eyebrow: "Download",
    heading: () => "Export this data",
    sub: "Enter your email to download the full results as CSV.",
    placeholder: "you@company.com",
    cta: "Email me the CSV",
  },
};

export default function LeadCapture({
  variant = "watch",
  entityType,
  entityId,
  entityName,
  sourcePage,
  className = "",
}: {
  variant?: Variant;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  sourcePage?: string;
  className?: string;
}) {
  const c = COPY[variant];
  const [email, setEmail] = useState("");
  const [criteria, setCriteria] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setErr("");
    try {
      const res = await fetch("/api/grid/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          intent: variant,
          entity_type: entityType,
          entity_id: entityId,
          entity_name: entityName,
          criteria: criteria || undefined,
          source_page: sourcePage || (typeof window !== "undefined" ? window.location.pathname : undefined),
        }),
      });
      const j = await res.json().catch(() => ({ ok: res.ok }));
      if (!res.ok || !j.ok) throw new Error(j.error || "Please try again.");
      setState("done");
    } catch (e) {
      setErr((e as Error).message || "Please try again.");
      setState("error");
    }
  }

  return (
    <div className={`rounded-2xl border border-purple-200 bg-purple-50 p-5 sm:p-6 ${className}`}>
      {state === "done" ? (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-purple-600">✓</span>
          <div>
            <p className="font-semibold text-gray-900">You&apos;re in.</p>
            <p className="mt-1 text-sm text-gray-600">
              {variant === "watch" && entityName
                ? `We'll email you when ${entityName} changes.`
                : variant === "access"
                  ? "We'll be in touch about full data access."
                  : "Check your inbox — your download link is on its way."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] font-mono uppercase tracking-wider text-purple-600">{c.eyebrow}</p>
          <h3 className="mt-1 text-lg font-bold text-gray-900">{c.heading(entityName)}</h3>
          <p className="mt-1 text-sm text-gray-600">{c.sub}</p>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={c.placeholder}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
            {c.criteria && (
              <input
                type="text"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder={c.criteria}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            )}
            <button
              type="submit"
              disabled={state === "loading"}
              className="rounded-lg bg-purple-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60"
            >
              {state === "loading" ? "Sending…" : c.cta}
            </button>
            {state === "error" && <p className="text-xs text-red-600">{err}</p>}
            <p className="text-[11px] text-gray-400">No spam. Just the alerts you asked for.</p>
          </form>
        </>
      )}
    </div>
  );
}
