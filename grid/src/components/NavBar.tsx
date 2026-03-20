"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { isDemoMode } from "@/lib/demoAccess";

const NAV_LINKS = [
  { href: "/grid/", label: "Dashboard", match: "/grid" },
  { href: "/grid/map/", label: "Map", match: "/grid/map" },
  { href: "/grid/sites/", label: "Greenfields", match: "/grid/sites" },
  { href: "/grid/brownfields/", label: "Industrial", match: "/grid/brownfields" },
  { href: "/grid/lines/", label: "Transmission", match: "/grid/lines" },
  { href: "/grid/corridors/", label: "Corridors", match: "/grid/corridors" },
  { href: "/grid/hyperscale/", label: "Hyperscale", match: "/grid/hyperscale" },
  { href: "/grid/market/", label: "Market", match: "/grid/market" },
  { href: "/grid/api-docs/", label: "API", match: "/grid/api-docs", fullOnly: true },
];

export default function NavBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const demo = isDemoMode();

  const isActive = (match: string) => {
    if (match === "/grid") return pathname === "/grid" || pathname === "/grid/";
    return pathname.startsWith(match);
  };

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <a href="/grid/" className="flex items-center gap-2 text-lg font-bold text-purple-600">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          GridScout
        </a>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-gray-600 hover:text-purple-600"
          aria-label="Toggle navigation menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>

        {/* Desktop nav links */}
        <div className="hidden md:flex gap-4 text-sm">
          {NAV_LINKS.filter(link => !demo || !link.fullOnly).map((link) => (
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

      {/* Mobile nav links */}
      {menuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-gray-200 flex flex-col gap-2 text-sm">
          {NAV_LINKS.filter(link => !demo || !link.fullOnly).map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`py-1.5 ${
                isActive(link.match)
                  ? "text-purple-600 font-semibold"
                  : "text-gray-600 hover:text-purple-600"
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
