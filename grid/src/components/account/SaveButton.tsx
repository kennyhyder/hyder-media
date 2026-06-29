"use client";

// Save/Watch toggle for any entity. Optimistic. Redirects logged-out users to
// /login with a return path. Degrades softly if accounts aren't enabled.

import { useEffect, useState } from "react";
import type { EntityType } from "@/lib/overrides";
import { authConfigured } from "@/lib/supabase-browser";

export default function SaveButton({
  entityType,
  entityId,
  label,
  meta,
}: {
  entityType: EntityType;
  entityId: string;
  label?: string;
  meta?: Record<string, unknown>;
}) {
  const [saved, setSaved] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Resolve signed-in + saved state via the API, which reads the @supabase/ssr
  // session cookie server-side and returns { signedIn, saved }. The entity page
  // stays static; only this fetch is per-user.
  useEffect(() => {
    fetch(
      `/api/account/save?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setSignedIn(!!d.signedIn);
          setSaved(!!d.saved);
        }
      })
      .catch(() => {});
  }, [entityType, entityId]);

  // Hide entirely if accounts aren't configured in this environment.
  if (!authConfigured()) return null;

  async function onClick() {
    if (!signedIn) {
      const here = typeof window !== "undefined" ? window.location.pathname : "/";
      window.location.href = `/login?next=${encodeURIComponent(here)}`;
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, label, meta }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        setMsg("Saving isn't available yet.");
        return;
      }
      const data = (await res.json()) as { saved: boolean };
      setSaved(data.saved);
    } catch {
      setMsg("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={saved}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60"
        style={
          saved
            ? { background: "color-mix(in srgb, var(--accent) 16%, transparent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
            : { borderColor: "var(--border)", color: "var(--text)" }
        }
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
        {saved ? "Saved" : "Save"}
      </button>
      {msg && <span className="text-[11px]" style={{ color: "var(--muted)" }}>{msg}</span>}
    </div>
  );
}
