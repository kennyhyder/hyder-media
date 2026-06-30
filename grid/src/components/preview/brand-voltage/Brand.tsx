import { V } from "./theme";

/**
 * Voltage monogram — a 3×3 grid of circuit nodes with the lower-right node
 * "energized" lime and a hairline trace routing power to it. Reads as a grid
 * census mark; works as a favicon at 16px. NOT a rotated square.
 */
export function VoltageMark({
  size = 28,
  lit = V.accent,
}: {
  size?: number;
  lit?: string;
}) {
  const s = size;
  const pad = s * 0.16;
  const span = s - pad * 2;
  const step = span / 2;
  const nodes: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      nodes.push([pad + c * step, pad + r * step]);
    }
  }
  const litNode = nodes[8]; // bottom-right
  const r0 = s * 0.052;
  const rLit = s * 0.085;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* trace: routes from top-left down the spine then across to the lit node */}
      <path
        d={`M ${nodes[0][0]} ${nodes[0][1]} V ${nodes[6][1]} H ${litNode[0]}`}
        stroke={lit}
        strokeWidth={s * 0.022}
        strokeLinecap="square"
        opacity={0.9}
      />
      {/* dim grid nodes */}
      {nodes.map(([x, y], i) =>
        i === 8 ? null : (
          <rect
            key={i}
            x={x - r0}
            y={y - r0}
            width={r0 * 2}
            height={r0 * 2}
            fill={V.muted}
            opacity={0.55}
          />
        )
      )}
      {/* energized node — square with a lime glow */}
      <rect
        x={litNode[0] - rLit}
        y={litNode[1] - rLit}
        width={rLit * 2}
        height={rLit * 2}
        fill={lit}
      />
      <rect
        x={litNode[0] - rLit - s * 0.05}
        y={litNode[1] - rLit - s * 0.05}
        width={(rLit + s * 0.05) * 2}
        height={(rLit + s * 0.05) * 2}
        stroke={lit}
        strokeWidth={s * 0.018}
        opacity={0.4}
      />
    </svg>
  );
}

/** Full lockup: monogram + GRIDCENSUS wordmark in tight uppercase grotesk. */
export function VoltageWordmark({ size = 28 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.42,
      }}
    >
      <VoltageMark size={size} />
      <span
        style={{
          fontFamily: "var(--vlt-display), system-ui, sans-serif",
          fontWeight: 600,
          fontSize: size * 0.62,
          letterSpacing: "0.14em",
          color: V.text,
          textTransform: "uppercase",
        }}
      >
        Grid<span style={{ color: V.muted }}>census</span>
      </span>
    </span>
  );
}
