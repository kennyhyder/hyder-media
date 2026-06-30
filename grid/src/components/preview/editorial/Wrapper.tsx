import type { ReactNode } from "react";
import { fontVars } from "./fonts";
import styles from "./editorial.module.css";

/**
 * Editorial Light canvas. Sets the warm-white background, scoped serif + mono
 * font variables, and editorial base typography for everything inside. Breaks
 * out of the root layout's centered <main> to paint full-bleed.
 */
export default function Wrapper({ children }: { children: ReactNode }) {
  return (
    <div className={`${fontVars} ${styles.root}`}>{children}</div>
  );
}

export { styles };
