"use client";

import { useState } from "react";
import { isDemoMode } from "@/lib/demoAccess";

export default function DemoBanner() {
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
        alignItems: "center",
        gap: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        maxWidth: "340px",
        fontSize: "13px",
        color: "#92400e",
        lineHeight: "1.4",
      }}
    >
      <svg
        style={{ width: "16px", height: "16px", flexShrink: 0, color: "#f59e0b" }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>
        <strong>Demo</strong> &mdash; Limited preview.{" "}
        <a href="mailto:kenny@hyder.me" style={{ textDecoration: "underline", fontWeight: 600 }}>
          Contact for full access
        </a>
      </span>
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
