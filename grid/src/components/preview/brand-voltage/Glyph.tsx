import { V } from "./theme";

/**
 * Voltage letterform marks — a letter "energized" on a circuit-node grid.
 * Same DNA as the original VoltageMark (square nodes, one bright energized
 * node, a hairline power trace), but the lit nodes now spell a letter.
 *
 *  - "C" fits cleanly in a 3×3 field (also reads as Census).
 *  - "G" needs a 4×4 field to get its inner spur without becoming a block.
 *
 * Both render on a square viewBox so they work as a favicon down to 16px.
 */

type Cell = [number, number]; // [col, row]

type Glyph = {
  cols: number;
  rows: number;
  lit: Cell[]; // nodes that form the letter
  energized: Cell; // the single bright node (power terminus)
  trace: Cell[]; // ordered path the power routes through
  showField?: boolean; // draw the faint full grid behind the letter
};

const C_GLYPH: Glyph = {
  cols: 3,
  rows: 3,
  lit: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  energized: [2, 2],
  trace: [
    [2, 0],
    [0, 0],
    [0, 2],
    [2, 2],
  ],
  showField: true,
};

// G = the same 3×3 ring as C, but the energized node moves to the CENTER —
// that center node is the G's inner spur (its tongue), with the mid-right node
// left open. C and G differ only by where the spark sits.
const G_GLYPH: Glyph = {
  cols: 3,
  rows: 3,
  lit: [
    [0, 0],
    [1, 0],
    [2, 0], // top bar
    [0, 1], // left wall
    [0, 2],
    [1, 2],
    [2, 2], // bottom bar
  ],
  energized: [1, 1], // center spur — the only difference from C
  trace: [
    [2, 0],
    [0, 0],
    [0, 2],
    [2, 2],
    [2, 1], // up the right side…
    [1, 1], // …then turn inward to the spur
  ],
  showField: true,
};

export const GLYPHS = { C: C_GLYPH, G: G_GLYPH } as const;
export type GlyphLetter = keyof typeof GLYPHS;

function xy([c, r]: Cell, g: Glyph, S: number): [number, number] {
  const pad = S * 0.17;
  const span = S - pad * 2;
  const grid = Math.max(g.cols, g.rows);
  const step = span / (grid - 1);
  // center the (possibly non-square) letter inside the square box
  const offX = (span - step * (g.cols - 1)) / 2;
  const offY = (span - step * (g.rows - 1)) / 2;
  return [pad + offX + c * step, pad + offY + r * step];
}

export function VoltageGlyph({
  letter = "G",
  size = 28,
  field = true,
}: {
  letter?: GlyphLetter;
  size?: number;
  field?: boolean;
}) {
  const g = GLYPHS[letter];
  const S = size;
  const node = S * 0.05; // dim node half-size
  const litR = S * 0.066; // lit node half-size
  const eR = S * 0.092; // energized half-size
  const key = ([c, r]: Cell) => `${c},${r}`;
  const litSet = new Set(g.lit.map(key));
  const eKey = key(g.energized);

  // faint background field (every node in the cols×rows grid)
  const fieldCells: Cell[] = [];
  if (field && g.showField) {
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const k = `${c},${r}`;
        if (!litSet.has(k) && k !== eKey) fieldCells.push([c, r]);
      }
  }

  const tracePts = g.trace.map((cell) => xy(cell, g, S));
  const traceD = tracePts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");

  return (
    <svg
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* power trace through the letter */}
      <path
        d={traceD}
        stroke={V.accent}
        strokeWidth={S * 0.02}
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity={0.85}
      />
      {/* faint full grid */}
      {fieldCells.map((cell, i) => {
        const [x, y] = xy(cell, g, S);
        return (
          <rect
            key={`f${i}`}
            x={x - node}
            y={y - node}
            width={node * 2}
            height={node * 2}
            fill={V.muted}
            opacity={0.16}
          />
        );
      })}
      {/* lit letter nodes */}
      {g.lit.map((cell, i) => {
        if (key(cell) === eKey) return null;
        const [x, y] = xy(cell, g, S);
        return (
          <rect
            key={`l${i}`}
            x={x - litR}
            y={y - litR}
            width={litR * 2}
            height={litR * 2}
            fill={V.text}
          />
        );
      })}
      {/* energized node — bright lime + glow ring */}
      {(() => {
        const [x, y] = xy(g.energized, g, S);
        const gap = S * 0.05;
        return (
          <g key="e">
            <rect
              x={x - eR - gap}
              y={y - eR - gap}
              width={(eR + gap) * 2}
              height={(eR + gap) * 2}
              stroke={V.accent}
              strokeWidth={S * 0.016}
              opacity={0.4}
            />
            <rect x={x - eR} y={y - eR} width={eR * 2} height={eR * 2} fill={V.accent} />
          </g>
        );
      })()}
    </svg>
  );
}

/** Lockup: letterform mark + GRIDCENSUS wordmark. */
export function VoltageGlyphWordmark({
  letter = "G",
  size = 30,
}: {
  letter?: GlyphLetter;
  size?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.44 }}>
      <VoltageGlyph letter={letter} size={size} />
      <span
        style={{
          fontFamily: "var(--vlt-display), system-ui, sans-serif",
          fontWeight: 600,
          fontSize: size * 0.6,
          letterSpacing: "0.15em",
          color: V.text,
          textTransform: "uppercase",
        }}
      >
        Grid<span style={{ color: V.muted }}>census</span>
      </span>
    </span>
  );
}
