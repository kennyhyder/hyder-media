"use client";

// Row actions for /account/watchtower — v1: remove the watch.

import { useState } from "react";

export default function WatchRowActions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/account/watch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setGone(true);
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (gone) return null;
  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="text-xs underline"
      style={{ color: "var(--muted)" }}
    >
      {busy ? "Removing…" : "Stop watching"}
    </button>
  );
}
