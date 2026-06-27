"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

const PUBLIC_LINKS = [
  { href: "/datacenter-sites", label: "Locations", match: "/datacenter-sites" },
  { href: "/site-types", label: "Site Types", match: "/site-types" },
  { href: "/iso", label: "ISO Regions", match: "/iso" },
  { href: "/rankings", label: "Rankings", match: "/rankings" },
  { href: "/pricing", label: "Pricing", match: "/pricing" },
];

const TOOL_LINKS = [
  { href: "/dashboard", label: "Explore Dashboard" },
  { href: "/map", label: "Interactive Map" },
  { href: "/sites", label: "Greenfield Sites" },
  { href: "/brownfields", label: "Industrial Sites" },
  { href: "/lines", label: "Transmission" },
  { href: "/corridors", label: "Corridors" },
  { href: "/hyperscale", label: "Hyperscale" },
  { href: "/market", label: "Market" },
];

export default function NavBar() {
  const pathname = usePathname() || "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const isActive = (match: string) => pathname === match || pathname.startsWith(`${match}/`);

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 text-lg font-bold text-purple-600">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          MegaWatt Site
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
        <div className="hidden md:flex items-center gap-4 text-sm">
          {PUBLIC_LINKS.map((link) => (
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
          <div className="relative">
            <button
              onClick={() => setToolsOpen((v) => !v)}
              onBlur={() => setTimeout(() => setToolsOpen(false), 150)}
              className="text-gray-600 hover:text-purple-600"
              aria-haspopup="true"
              aria-expanded={toolsOpen}
            >
              Tools ▾
            </button>
            {toolsOpen && (
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {TOOL_LINKS.map((t) => (
                  <a
                    key={t.href}
                    href={t.href}
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700"
                  >
                    {t.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav links */}
      {menuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-gray-200 flex flex-col gap-2 text-sm">
          {PUBLIC_LINKS.map((link) => (
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
          <div className="mt-1 pt-2 border-t border-gray-100">
            <p className="py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Tools</p>
            {TOOL_LINKS.map((t) => (
              <a
                key={t.href}
                href={t.href}
                onClick={() => setMenuOpen(false)}
                className="block py-1.5 text-gray-600 hover:text-purple-600"
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
