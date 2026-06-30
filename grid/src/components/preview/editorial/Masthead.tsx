import { C } from "./theme";
import { styles } from "./Wrapper";

const NAV = [
  "Sites",
  "Corridors",
  "Substations",
  "Brownfields",
  "Methodology",
];

/**
 * Refined broadsheet masthead: serif wordmark, thin top + bottom rules, a
 * dateline strip, and a small uppercase nav. Print-publication framing.
 */
export default function Masthead({
  dateline,
}: {
  dateline?: string;
}) {
  return (
    <header style={{ background: C.surface, borderBottom: `1px solid ${C.hairline}` }}>
      {/* hairline accent rule at the very top */}
      <div style={{ height: 3, background: C.teal }} />
      <div className={styles.shell}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            padding: "1.5rem 0 1rem",
            gap: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.875rem" }}>
            <span
              className={styles.serif}
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: C.text,
              }}
            >
              GridCensus
            </span>
            <span
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                fontSize: "0.625rem",
                fontWeight: 600,
                color: C.muted,
                paddingBottom: "0.1rem",
              }}
            >
              Site Intelligence
            </span>
          </div>

          <nav
            style={{
              display: "flex",
              gap: "1.5rem",
              alignItems: "baseline",
            }}
          >
            {NAV.map((item) => (
              <span
                key={item}
                style={{
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: C.muted,
                }}
              >
                {item}
              </span>
            ))}
          </nav>
        </div>
      </div>

      {/* Dateline strip — double rule (broadsheet convention). */}
      <div style={{ borderTop: `1px solid ${C.hairline}` }}>
        <div
          className={styles.shell}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.5rem 0",
            borderTop: `2px solid ${C.text}`,
            marginTop: 1,
          }}
        >
          <span
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              fontSize: "0.625rem",
              fontWeight: 600,
              color: C.tealInk,
            }}
          >
            North American Edition
          </span>
          {dateline && (
            <span
              style={{
                fontSize: "0.6875rem",
                color: C.muted,
                fontStyle: "italic",
              }}
              className={styles.serif}
            >
              {dateline}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
