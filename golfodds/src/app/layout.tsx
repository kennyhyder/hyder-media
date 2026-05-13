import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GolfOdds — Kalshi vs Sportsbooks",
  description: "Golf odds discrepancy analyzer comparing Kalshi event contracts to sportsbook outright markets",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
