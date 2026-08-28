"use client";

// Watchtower toggle — "Watch this site/place": GridCensus re-scans the siting
// signals on a schedule and emails on change. Mirrors SaveButton's pattern
// (cookie-session state via API, optimistic, soft-degrading). A 402 from the
// API means the free-tier watch cap was hit → offer the Pro upgrade.

import { useEffect, useState } from "react";
import { authConfigured } from "@/lib/supabase-browser";

export default function WatchButton({
  siteId,
  lat,
  lng,
  label,
  targetMw,
}: {
  siteId?: string;
  lat?: number;
  lng?: number;
  label?: string;
  targetMw?: number | null;
}) {
  const [watched, setWatched] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);

  const qs = siteId
    ? `dc_site_id=${encodeURIComponent(siteId)}`
    : lat != null && lng != null
      ? `lat=${lat}&lng=${lng}`
      : null;

  useEffect(() => {
    if (!qs) return;
    fetch(`/api/account/watch?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setSignedIn(!!d.signedIn);
          setWatched(!!d.watched);
          setWatchId(d.id ?? null);
        }
      })
      .catch(() => {});
  }, [qs]);

  if (!authConfigured() || !qs) return null;

  async function onClick() {
    if (!signedIn) {
      const here = typeof window !== "undefined" ? window.location.pathname : "/";
      window.location.href = `/login?next=${encodeURIComponent(here)}`;
      return;
    }
    setBusy(true);
    setMsg(null);
    setUpgrade(false);
    try {
      if (watched && watchId) {
        const res = await fetch("/api/account/watch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: watchId }),
        });
        if (res.ok) {
          setWatched(false);
          setWatchId(null);
        }
        return;
      }
      const body = siteId
        ? { kind: "site", dc_site_id: siteId, label, target_mw: targetMw ?? undefined }
        : { kind: "place", lat, lng, label: label || "Pinned location", target_mw: targetMw ?? undefined };
      const res = await fetch("/api/account/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 402) {
        setMsg("Watch limit reached on the free tier.");
        setUpgrade(true);
        return;
      }
      if (!res.ok) {
        setMsg("Watching isn't available yet.");
        return;
      }
      const data = (await res.json()) as { ok: boolean; id?: string };
      if (data.ok) {
        setWatched(true);
        setWatchId(data.id ?? null);
      }
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
        aria-pressed={watched}
        title="Get an email digest when this location's siting signals change"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60"
        style={
          watched
            ? { background: "color-mix(in srgb, var(--accent) 16%, transparent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
            : { borderColor: "var(--border)", color: "var(--text)" }
        }
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" fill={watched ? "currentColor" : "none"} />
        </svg>
        {watched ? "Watching" : "Watch"}
      </button>
      {msg && (
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {msg}{" "}
          {upgrade && (
            <a href="/pricing" className="underline" style={{ color: "var(--accent-ink)" }}>
              Upgrade to Pro
            </a>
          )}
        </span>
      )}
    </div>
  );
}
