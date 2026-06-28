"use client";

// "Suggest an edit" control for any entity. Captures a single field change
// (field + new value) plus a REQUIRED source citation, posts to
// /api/account/contribute. Also supports a quick "report stale" path.

import { useEffect, useState } from "react";
import type { EntityType } from "@/lib/overrides";
import { ACCESS_COOKIE, authConfigured } from "@/lib/supabase-browser";

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && c.length > ACCESS_COOKIE.length + 1);
}

export default function SuggestEditButton({
  entityType,
  entityId,
  fields = [],
}: {
  entityType: EntityType;
  entityId: string;
  /** Suggested editable field names to seed the dropdown. */
  fields?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(fields[0] ?? "");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(hasSessionCookie());
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

  async function submit(kind: "edit" | "report_stale") {
    if (kind === "edit" && (!field || !value || !source.trim())) {
      setError("Field, value, and a source citation are all required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/contribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          kind,
          diff: kind === "edit" ? { [field]: { to: value } } : {},
          source: kind === "edit" ? source : note || "stale report",
          note: note || undefined,
        }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error === "source_required" ? "A source citation is required." : "Submissions aren't available yet.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
        Thanks — your suggestion is in the moderation queue.
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
          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Suggest an edit
      </button>
    );
  }

  const inputStyle = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" } as React.CSSProperties;

  return (
    <div className="surface-card rounded-xl p-4">
      <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Suggest an edit</p>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Edits never overwrite source data directly — approved changes are
        merged on top, with your citation kept on record.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          {fields.length ? (
            <select value={field} onChange={(e) => setField(e.target.value)} className="rounded-lg border px-2 py-2 text-sm" style={inputStyle}>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input placeholder="field" value={field} onChange={(e) => setField(e.target.value)} className="w-1/2 rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
          )}
          <input placeholder="new value" value={value} onChange={(e) => setValue(e.target.value)} className="flex-1 rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
        </div>
        <input placeholder="Source URL or citation (required)" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => submit("edit")} disabled={busy} className="accent-fill rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60">
          {busy ? "…" : "Submit edit"}
        </button>
        <button type="button" onClick={() => submit("report_stale")} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          Report stale
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: "var(--score-low)" }}>{error}</p>}
    </div>
  );
}
