import { C } from "./theme";

/**
 * Current monogram — a geometric "G" cut from a grid: a rounded-square frame
 * with a gap at the upper-right and an inward indigo bar (the G's terminal),
 * crossed by two faint grid hairlines. Authoritative, balanced, favicon-safe.
 * NOT a rotated square.
 */
export function CurrentMark({
  size = 28,
  accent = C.accent,
}: {
  size?: number;
  accent?: string;
}) {
  const s = size;
  const sw = s * 0.11;
  const inset = sw / 2 + s * 0.06;
  const box = s - inset * 2;
  const r = s * 0.22;
  const cx = s / 2;
  const cy = s / 2;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* faint internal grid hairlines */}
      <line x1={cx} y1={inset} x2={cx} y2={s - inset} stroke={C.border} strokeWidth={s * 0.02} />
      <line x1={inset} y1={cy} x2={s - inset} y2={cy} stroke={C.border} strokeWidth={s * 0.02} />

      {/* G arc: rounded-square stroke with the top-right segment omitted */}
      <path
        d={`
          M ${cx} ${inset}
          H ${inset + r}
          A ${r} ${r} 0 0 0 ${inset} ${inset + r}
          V ${s - inset - r}
          A ${r} ${r} 0 0 0 ${inset + r} ${s - inset}
          H ${s - inset - r}
          A ${r} ${r} 0 0 0 ${s - inset} ${s - inset - r}
          V ${cy}
        `}
        stroke={C.text}
        strokeWidth={sw}
        strokeLinecap="round"
        fill="none"
      />
      {/* the G's inward terminal bar — electric indigo */}
      <line
        x1={s - inset}
        y1={cy}
        x2={cx + s * 0.02}
        y2={cy}
        stroke={accent}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Lockup: G mark + "GridCensus" in confident geometric sans. */
export function CurrentWordmark({ size = 28 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.42 }}>
      <CurrentMark size={size} />
      <span
        style={{
          fontFamily: "var(--cur-display), system-ui, sans-serif",
          fontWeight: 700,
          fontSize: size * 0.66,
          letterSpacing: "-0.02em",
          color: C.text,
          lineHeight: 1,
        }}
      >
        Grid<span style={{ color: C.accentSoft, fontWeight: 600 }}>Census</span>
      </span>
    </span>
  );
}
