"use client";

import { useEffect, useState } from "react";

// "Trending this week" — the self-feedback loop's visible half. Reads the
// GSC opportunity engine's public snapshots (hyder.me/api/seo/fleet-trending)
// and internal-links the pages Google is currently rewarding, sitewide,
// with zero rebuilds. Renders nothing until data exists.
interface Riser {
  page: string;
  category: string;
  impressions: number;
  position: number;
}

export function TrendingNow({ domain, title = "Trending this week" }: {
  domain: string;
  title?: string;
}) {
  const [items, setItems] = useState<Riser[]>([]);
  useEffect(() => {
    let dead = false;
    fetch(`https://hyder.me/api/seo/fleet-trending?domain=${domain}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead || !d?.risers) return;
        const seen = new Set<string>();
        const rows = (d.risers as Riser[])
          .filter((r) => {
            try {
              const u = new URL(r.page);
              if (u.hostname.replace(/^www\./, "") !== domain) return false;
              if (u.pathname === "/" || seen.has(u.pathname)) return false;
              seen.add(u.pathname);
              return true;
            } catch { return false; }
          })
          .slice(0, 6);
        setItems(rows);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [domain]);

  if (items.length < 2) return null;
  const label = (p: string) => {
    const path = new URL(p).pathname;
    return decodeURIComponent(path)
      .split("/").filter(Boolean).pop()!.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };
  return (
    <nav aria-label={title} style={{
      margin: "2rem 0 0", padding: "1rem 1.25rem",
      border: "1px solid var(--border, rgba(128,128,128,.25))",
      borderRadius: 12, fontSize: ".85rem",
    }}>
      <div style={{
        textTransform: "uppercase", letterSpacing: ".1em", fontSize: ".68rem",
        opacity: .65, marginBottom: ".55rem",
      }}>
        📈 {title}
      </div>
      <ul style={{
        listStyle: "none", margin: 0, padding: 0, display: "flex",
        flexWrap: "wrap", gap: ".4rem .9rem",
      }}>
        {items.map((r) => (
          <li key={r.page}>
            <a href={new URL(r.page).pathname} className="app-accent">
              {label(r.page)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
