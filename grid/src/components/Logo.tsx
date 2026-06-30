// GridCensus brand mark — the Voltage "G" monogram: a 3×3 grid of circuit
// nodes spelling a G, with the center node "energized" lime (the brand signal)
// and a hairline power trace routing into it.
//
// THEME-AWARE by design so the one component works in BOTH light and dark:
//   - dim grid nodes  → currentColor (inherits the surrounding text color)
//   - lit letter nodes → currentColor (the wordmark/text color)
//   - energized node + trace → var(--accent) (the lime signal, both themes)
//
// Adapted from src/components/preview/brand-voltage/Glyph.tsx (the locked logo).
// The preview copy is left intact; this is the promoted, app-wide version.

type Cell = [number, number]; // [col, row]

// G = a 3×3 ring with the energized node at the CENTER (the G's inner spur).
const G_LIT: Cell[] = [
  [0, 0],
  [1, 0],
  [2, 0], // top bar
  [0, 1], // left wall
  [0, 2],
  [1, 2],
  [2, 2], // bottom bar
];
const G_ENERGIZED: Cell = [1, 1];
const G_TRACE: Cell[] = [
  [2, 0],
  [0, 0],
  [0, 2],
  [2, 2],
  [2, 1], // up the right side…
  [1, 1], // …then turn inward to the spur
];
const COLS = 3;
const ROWS = 3;

function xy([c, r]: Cell, S: number): [number, number] {
  const pad = S * 0.17;
  const span = S - pad * 2;
  const step = span / (Math.max(COLS, ROWS) - 1);
  return [pad + c * step, pad + r * step];
}

/**
 * The G monogram alone. Theme-aware: grid + letter nodes use `currentColor`
 * (so wrap it in a `style={{ color: ... }}` or let it inherit), the energized
 * node + trace use the lime `--accent`.
 */
export function LogoMark({ size = 28, field = true }: { size?: number; field?: boolean }) {
  const S = size;
  const node = S * 0.05; // dim node half-size
  const litR = S * 0.066; // lit node half-size
  const eR = S * 0.092; // energized half-size
  const key = ([c, r]: Cell) => `${c},${r}`;
  const litSet = new Set(G_LIT.map(key));
  const eKey = key(G_ENERGIZED);

  // faint background field (every node not part of the letter)
  const fieldCells: Cell[] = [];
  if (field) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = `${c},${r}`;
        if (!litSet.has(k) && k !== eKey) fieldCells.push([c, r]);
      }
  }

  const traceD = G_TRACE.map((cell) => {
    const p = xy(cell, S);
    return `${cell === G_TRACE[0] ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  }).join(" ");

  return (
    <svg
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* power trace into the energized spur */}
      <path
        d={traceD}
        stroke="var(--accent)"
        strokeWidth={S * 0.02}
        strokeLinecap="square"
        strokeLinejoin="miter"
        opacity={0.85}
      />
      {/* faint full grid — inherits text color, dimmed */}
      {fieldCells.map((cell, i) => {
        const [x, y] = xy(cell, S);
        return (
          <rect
            key={`f${i}`}
            x={x - node}
            y={y - node}
            width={node * 2}
            height={node * 2}
            fill="currentColor"
            opacity={0.22}
          />
        );
      })}
      {/* lit letter nodes — the wordmark color */}
      {G_LIT.map((cell, i) => {
        if (key(cell) === eKey) return null;
        const [x, y] = xy(cell, S);
        return (
          <rect
            key={`l${i}`}
            x={x - litR}
            y={y - litR}
            width={litR * 2}
            height={litR * 2}
            fill="currentColor"
          />
        );
      })}
      {/* energized node — bright lime + glow ring */}
      {(() => {
        const [x, y] = xy(G_ENERGIZED, S);
        const gap = S * 0.05;
        return (
          <g>
            <rect
              x={x - eR - gap}
              y={y - eR - gap}
              width={(eR + gap) * 2}
              height={(eR + gap) * 2}
              stroke="var(--accent)"
              strokeWidth={S * 0.016}
              opacity={0.4}
            />
            <rect x={x - eR} y={y - eR} width={eR * 2} height={eR * 2} fill="var(--accent)" />
          </g>
        );
      })()}
    </svg>
  );
}

/**
 * Full brand lockup: G monogram + GRIDCENSUS wordmark. Links to "/" by default.
 * Theme-aware — the mark inherits `--text` via currentColor; "census" dims to
 * `--muted`. Display type uses Space Grotesk via --vlt-display.
 */
export default function Logo({ size = 28, href = "/" }: { size?: number; href?: string | null }) {
  const inner = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.44, color: "var(--text)" }}>
      <LogoMark size={size} />
      <span
        style={{
          fontFamily: "var(--vlt-display), system-ui, sans-serif",
          fontWeight: 600,
          fontSize: size * 0.58,
          letterSpacing: "0.15em",
          color: "var(--text)",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        Grid<span style={{ color: "var(--muted)" }}>census</span>
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <a href={href} style={{ textDecoration: "none" }} aria-label="GridCensus home">
      {inner}
    </a>
  );
}
