// Scoped fonts for the Editorial Light preview. Loaded via next/font/google so
// they're self-contained to these components and don't disturb the global
// Geist theme. Exposed as CSS variables the wrapper applies on its subtree.

import { Source_Serif_4, IBM_Plex_Mono } from "next/font/google";

// Serif display + reading face — the spine of the editorial look.
export const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--ed-serif",
});

// Mono for ALL figures — tabular numerals for column alignment.
export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--ed-mono",
});

export const fontVars = `${serif.variable} ${mono.variable}`;
