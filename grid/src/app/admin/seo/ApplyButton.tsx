"use client";

import { useState } from "react";

/**
 * Fires the auto-apply route for one opportunity and surfaces the result inline.
 * Staff-only (the page is already staff-gated; the route re-checks).
 */
export default function ApplyButton({ opportunityId }: { opportunityId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  async function apply() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/admin/seo/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setState("done");
        setMsg("Applied");
      } else if (json.mode === "manual") {
        setState("error");
        setMsg(json.reason || "Manual apply needed (no Claude key)");
      } else {
        setState("error");
        setMsg(json.reason || json.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={apply}
        disabled={state === "loading" || state === "done"}
        className="rounded-md px-3 py-1 text-xs font-semibold"
        style={{
          background: state === "done" ? "var(--ok, #16a34a)" : "var(--accent, #2563eb)",
          color: "#fff",
          opacity: state === "loading" ? 0.6 : 1,
        }}
      >
        {state === "loading" ? "Applying…" : state === "done" ? "Applied" : "Apply"}
      </button>
      {msg && (
        <span
          className="text-xs"
          style={{ color: state === "error" ? "var(--danger, #dc2626)" : "var(--muted)" }}
        >
          {msg}
        </span>
      )}
    </span>
  );
}
