"use client";

import { useEffect, useRef, useState } from "react";
import { CR, glass, labelStyle, mono, scoreColor } from "./theme";

// Count-up animation for the in-view figures (gentle, ~500ms).
function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const dur = 500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [target]);

  return val;
}

export default function StatReadout({
  count,
  avgScore,
  loading,
}: {
  count: number;
  avgScore: number | null;
  loading: boolean;
}) {
  const shownCount = useCountUp(count);
  const avg = avgScore == null ? null : Math.round(avgScore * 10) / 10;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 1100,
        padding: "11px 14px",
        ...glass,
        display: "flex",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div>
        <div style={{ ...labelStyle, marginBottom: 3 }}>▮ Sites in view</div>
        <div
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontSize: 20,
            fontWeight: 700,
            color: CR.text,
            lineHeight: 1,
          }}
        >
          {shownCount.toLocaleString("en-US")}
        </div>
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: CR.border }} />
      <div>
        <div style={{ ...labelStyle, marginBottom: 3 }}>Avg readiness</div>
        <div
          style={{
            fontFamily: mono,
            fontVariantNumeric: "tabular-nums",
            fontSize: 20,
            fontWeight: 700,
            color: avg == null ? CR.muted : scoreColor(avg),
            lineHeight: 1,
          }}
        >
          {avg == null ? "—" : avg.toFixed(1)}
        </div>
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: CR.border }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          className="gc-live-dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: loading ? CR.cyan : "#A3E635",
            boxShadow: `0 0 8px ${loading ? CR.cyan : "#A3E635"}`,
          }}
        />
        <span
          style={{
            ...labelStyle,
            color: loading ? CR.cyan : "#A3E635",
            fontSize: 10,
          }}
        >
          {loading ? "Syncing" : "Live"}
        </span>
      </div>
    </div>
  );
}
