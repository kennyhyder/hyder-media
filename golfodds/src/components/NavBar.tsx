"use client";

import Link from "next/link";

export default function NavBar() {
  return (
    <nav className="border-b border-neutral-800 bg-neutral-950">
      <div className="max-w-[1800px] mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-green-500 font-bold text-lg">
          <span>⛳</span>
          <span>GolfOdds</span>
        </Link>
        <div className="text-xs text-neutral-500">Kalshi vs Sportsbook Outright Analyzer</div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/" className="text-neutral-300 hover:text-green-400">Tournaments</Link>
          <a
            href="https://docs.kalshi.com/api-reference"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-500 hover:text-neutral-300 text-xs"
          >Kalshi API ↗</a>
          <a
            href="https://datagolf.com/api-access"
            target="_blank"
            rel="noreferrer"
            className="text-neutral-500 hover:text-neutral-300 text-xs"
          >DataGolf ↗</a>
        </div>
      </div>
    </nav>
  );
}
