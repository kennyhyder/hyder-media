"use client";

// Global floating tray showing the current compare set. Mounted once in the
// root layout. Reads localStorage `gc_compare` (shared with AddToCompareButton
// + the /compare tool), updates live on the `gc-compare-change` event, and
// hides itself on the /compare page and when printing.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { readCompare, type CompareItem } from "./AddToCompareButton";

export default function CompareTray() {
  const pathname = usePathname();
  const [items, setItems] = useState<CompareItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => setItems(readCompare());
    sync();
    window.addEventListener("gc-compare-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("gc-compare-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!mounted || items.length === 0 || pathname?.startsWith("/compare")) return null;

  const ids = items.map((x) => x.id).join(",");
  const clear = () => {
    window.localStorage.removeItem("gc_compare");
    window.dispatchEvent(new Event("gc-compare-change"));
  };

  return (
    <div className="print-hide fixed bottom-4 left-1/2 z-[1200] flex -translate-x-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-xs font-medium text-gray-600">
        <span className="font-bold text-purple-700">{items.length}</span> site{items.length === 1 ? "" : "s"} to compare
      </span>
      <a
        href={`/compare?ids=${ids}`}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition ${
          items.length >= 2 ? "bg-purple-600 hover:bg-purple-700" : "pointer-events-none bg-gray-300"
        }`}
        aria-disabled={items.length < 2}
      >
        Compare
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
      <button onClick={clear} className="text-xs text-gray-400 hover:text-gray-600" title="Clear compare list">
        Clear
      </button>
    </div>
  );
}
