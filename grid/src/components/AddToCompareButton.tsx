"use client";

// Toggles the current site in the localStorage compare set (`gc_compare`),
// shared with CompareTray (global) and the /compare tool. Emits a
// `gc-compare-change` event so the tray updates without a reload.

import { useEffect, useState } from "react";

export interface CompareItem {
  id: string;
  name: string;
}

const KEY = "gc_compare";
const MAX = 10;

export function readCompare(): CompareItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.id) : [];
  } catch {
    return [];
  }
}

function writeCompare(items: CompareItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  window.dispatchEvent(new Event("gc-compare-change"));
}

export default function AddToCompareButton({ id, name }: CompareItem) {
  const [added, setAdded] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => {
      const items = readCompare();
      setAdded(items.some((x) => x.id === id));
      setFull(items.length >= MAX && !items.some((x) => x.id === id));
    };
    sync();
    window.addEventListener("gc-compare-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("gc-compare-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, [id]);

  const toggle = () => {
    const items = readCompare();
    if (items.some((x) => x.id === id)) {
      writeCompare(items.filter((x) => x.id !== id));
    } else if (items.length < MAX) {
      writeCompare([...items, { id, name }]);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={full}
      title={full ? "Compare list is full (10 max)" : undefined}
      className={`print-hide inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        added
          ? "border-purple-500 bg-purple-50 text-purple-700"
          : "border-gray-300 bg-white text-gray-700 hover:border-purple-400 hover:text-purple-700"
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {added ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <path d="M3 6h18M3 12h18M3 18h18" />
            <path d="M18 3v6M15 6h6" />
          </>
        )}
      </svg>
      {added ? "In compare" : "Add to compare"}
    </button>
  );
}
