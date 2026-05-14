"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, StarOff } from "lucide-react";
import { toast } from "sonner";

interface Props {
  signedIn: boolean;
  initialActive: boolean;
  initialId?: number;
  kind: "team" | "player" | "event" | "tournament";
  refId: string;
  label: string;
  league: string;
  source?: "sports" | "golf";
  size?: "sm" | "md";
}

// One-click bookmark button. Anonymous users see a sign-up nudge.
// Signed-in users (any tier) can bookmark — used by Elite's "My watchlist"
// smart-preset alerts to filter dispatches.
export default function WatchlistButton({ signedIn, initialActive, initialId, kind, refId, label, league, source = "sports", size = "md" }: Props) {
  const [active, setActive] = useState(initialActive);
  const [id, setId] = useState<number | undefined>(initialId);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (!signedIn) {
      toast.info("Sign in to bookmark — it's free.");
      router.push(`/signup?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    try {
      if (active) {
        const r = await fetch(`/api/watchlist?${id ? `id=${id}` : `ref_id=${refId}`}`, { method: "DELETE" });
        if (!r.ok) { toast.error("Failed to remove"); return; }
        setActive(false);
        setId(undefined);
        toast.success(`Removed ${label}`);
      } else {
        const r = await fetch(`/api/watchlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, ref_id: refId, label, league, source }),
        });
        const data = await r.json();
        if (!r.ok) { toast.error(data.error || "Failed"); return; }
        setActive(true);
        setId(data.item?.id);
        toast.success(`Added ${label} to watchlist`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const cls = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={active ? `Remove ${label} from watchlist` : `Bookmark ${label}`}
      aria-label={active ? "Remove from watchlist" : "Add to watchlist"}
      className={`inline-flex items-center justify-center rounded transition ${active ? "text-amber-500 hover:text-amber-400" : "text-muted-foreground/50 hover:text-amber-500"}`}
    >
      {active ? <Star className={`${cls} fill-current`} /> : <StarOff className={cls} />}
    </button>
  );
}
