import { A } from "./theme";

/**
 * Amber monogram — a stylized lattice transmission tower: a tapering trapezoid
 * body with two cross-arms and an X-brace, the top insulator point lit gold.
 * Geometric, symmetric, works as a favicon. NOT a rotated square.
 */
export function AmberMark({
  size = 28,
  lit = A.accent,
}: {
  size?: number;
  lit?: string;
}) {
  const s = size;
  const sw = s * 0.05;
  // tower geometry within a padded box
  const topY = s * 0.16;
  const botY = s * 0.86;
  const topHalf = s * 0.13; // half-width at top
  const botHalf = s * 0.3; // half-width at base
  const cx = s / 2;
  const tL = cx - topHalf;
  const tR = cx + topHalf;
  const bL = cx - botHalf;
  const bR = cx + botHalf;
  // cross-arm rows
  const armY1 = topY + (botY - topY) * 0.22;
  const armY2 = topY + (botY - topY) * 0.46;
  const half1 = topHalf + (botHalf - topHalf) * 0.22 + s * 0.1;
  const half2 = topHalf + (botHalf - topHalf) * 0.46 + s * 0.06;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* legs */}
      <path d={`M ${tL} ${topY} L ${bL} ${botY}`} stroke={A.text} strokeWidth={sw} strokeLinecap="round" />
      <path d={`M ${tR} ${topY} L ${bR} ${botY}`} stroke={A.text} strokeWidth={sw} strokeLinecap="round" />
      {/* X-brace between top and base */}
      <path d={`M ${tL} ${topY} L ${bR} ${botY}`} stroke={A.muted} strokeWidth={sw * 0.6} opacity={0.7} />
      <path d={`M ${tR} ${topY} L ${bL} ${botY}`} stroke={A.muted} strokeWidth={sw * 0.6} opacity={0.7} />
      {/* cross-arms */}
      <line x1={cx - half1} y1={armY1} x2={cx + half1} y2={armY1} stroke={A.text} strokeWidth={sw} strokeLinecap="round" />
      <line x1={cx - half2} y1={armY2} x2={cx + half2} y2={armY2} stroke={A.text} strokeWidth={sw} strokeLinecap="round" />
      {/* top insulator — lit gold */}
      <circle cx={cx} cy={topY} r={s * 0.075} fill={lit} />
      <circle cx={cx} cy={topY} r={s * 0.13} stroke={lit} strokeWidth={sw * 0.5} opacity={0.4} />
    </svg>
  );
}

/** Lockup: tower mark + serif "Grid" + lighter "Census". Refined editorial feel. */
export function AmberWordmark({ size = 30 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.38 }}>
      <AmberMark size={size} />
      <span
        style={{
          fontFamily: "var(--amb-serif), Georgia, serif",
          fontWeight: 600,
          fontSize: size * 0.74,
          letterSpacing: "-0.01em",
          color: A.text,
          lineHeight: 1,
        }}
      >
        Grid
        <span style={{ color: A.muted, fontWeight: 400, fontStyle: "italic" }}>
          census
        </span>
      </span>
    </span>
  );
}
