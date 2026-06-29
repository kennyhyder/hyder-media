// Scoped fonts for the Voltage brand direction. Loaded via next/font/google so
// they're self-contained and don't disturb the global Geist theme.
// Space Grotesk = tight modern grotesk for display; Geist Mono kept for figures.

import { Space_Grotesk, Geist_Mono } from "next/font/google";

export const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--vlt-display",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--vlt-mono",
});

export const fontVars = `${display.variable} ${mono.variable}`;
