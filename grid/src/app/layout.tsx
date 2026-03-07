"use client";

import { Geist, Geist_Mono } from "next/font/google";
import { usePathname } from "next/navigation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const NAV_LINKS = [
  { href: "/grid/", label: "Dashboard", match: "/grid" },
  { href: "/grid/map/", label: "Map", match: "/grid/map" },
  { href: "/grid/sites/", label: "DC Sites", match: "/grid/sites" },
  { href: "/grid/brownfields/", label: "Brownfields", match: "/grid/brownfields" },
  { href: "/grid/search/", label: "Lines", match: "/grid/search" },
  { href: "/grid/corridors/", label: "Corridors", match: "/grid/corridors" },
  { href: "/grid/market/", label: "Market", match: "/grid/market" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();

  const isActive = (match: string) => {
    if (match === "/grid") return pathname === "/grid" || pathname === "/grid/";
    return pathname.startsWith(match);
  };

  return (
    <html lang="en">
      <head>
        <title>GridScout - Transmission Infrastructure Intelligence</title>
        <meta name="description" content="Datacenter site selection intelligence: scored candidate sites, brownfield opportunities, and market analysis across the United States." />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}
      >
        <nav className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <a href="/grid/" className="flex items-center gap-2 text-lg font-bold text-purple-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              GridScout
            </a>
            <div className="flex gap-4 text-sm flex-wrap">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={
                    isActive(link.match)
                      ? "text-purple-600 font-semibold"
                      : "text-gray-600 hover:text-purple-600"
                  }
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
