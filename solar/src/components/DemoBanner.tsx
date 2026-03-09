"use client";

import { useState } from "react";
import { isDemoMode } from "@/lib/demoAccess";

interface DemoLimits {
  hourly_limit: number;
  daily_limit: number;
  hourly_remaining: number;
  daily_remaining: number;
  lifetime_limit?: number | null;
  lifetime_remaining?: number | null;
}

export default function DemoBanner({ limits }: { limits?: DemoLimits | null }) {
  const [dismissed, setDismissed] = useState(false);

  if (!isDemoMode() || dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 9999,
        background: "#fffbeb",
        border: "1px solid #fcd34d",
        borderRadius: "8px",
        padding: "10px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        maxWidth: "360px",
        fontSize: "13px",
        color: "#92400e",
        lineHeight: "1.4",
      }}
    >
      <svg
        style={{ width: "16px", height: "16px", flexShrink: 0, color: "#f59e0b", marginTop: "1px" }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div>
        <div>
          <strong>Demo</strong> &mdash; Limited preview.{" "}
          <a href="mailto:kenny@hyder.me?subject=SolarTrack Full Access Request" style={{ textDecoration: "underline", fontWeight: 600 }}>
            Contact for full access
          </a>
        </div>
        {limits && (
          <div style={{ marginTop: "4px", fontSize: "11px", opacity: 0.8 }}>
            {limits.hourly_remaining}/{limits.hourly_limit} hourly &middot; {limits.daily_remaining}/{limits.daily_limit} daily
            {limits.lifetime_limit != null && limits.lifetime_remaining != null && (
              <span> &middot; {limits.lifetime_remaining}/{limits.lifetime_limit} lifetime</span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 0 0 4px",
          color: "#92400e",
          fontSize: "16px",
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
