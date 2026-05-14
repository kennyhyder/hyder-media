import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { GoogleAnalytics } from "@next/third-parties/google";
import ThemeProviderClient from "@/components/ThemeProviderClient";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

const GA_ID = "G-WVTRLTCENT";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SportsBookish — Find the edge on Kalshi vs the books",
  description:
    "Live edge alerts comparing Kalshi event-contract prices to sportsbook consensus across golf, NBA, MLB, NHL and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProviderClient>
          {children}
          <Toaster position="top-right" richColors />
          {/* Site-wide floating theme toggle — visible on every page */}
          <div className="fixed bottom-3 right-3 z-50 rounded-full border border-border bg-background/80 backdrop-blur shadow-md">
            <ThemeToggle compact />
          </div>
        </ThemeProviderClient>
        <GoogleAnalytics gaId={GA_ID} />
      </body>
    </html>
  );
}
