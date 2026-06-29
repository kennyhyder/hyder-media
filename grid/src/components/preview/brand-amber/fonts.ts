// Scoped fonts for the Amber brand direction. Fraunces (serif display) +
// Geist (clean sans body) + Geist Mono for figures. next/font keeps them
// isolated from the global Geist theme vars.

import { Fraunces, Geist, Geist_Mono } from "next/font/google";

export const serif = Fraunces({
  subsets: ["latin"],
  display: "swap",
  // variable font (no explicit weight) — optical sizing comes for free.
  variable: "--amb-serif",
});

export const sans = Geist({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--amb-sans",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--amb-mono",
});

export const fontVars = `${serif.variable} ${sans.variable} ${mono.variable}`;
