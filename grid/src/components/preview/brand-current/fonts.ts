// Scoped fonts for the Current brand direction. Sora (confident geometric sans)
// for display + body, Geist Mono for figures. Isolated via next/font.

import { Sora, Geist_Mono } from "next/font/google";

export const display = Sora({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--cur-display",
});

export const mono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--cur-mono",
});

export const fontVars = `${display.variable} ${mono.variable}`;
