"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";

export interface NavDropdownItem {
  label: string;
  href: string;
  description?: string;
  icon?: LucideIcon;
  badge?: string;
}

export interface NavDropdownSection {
  heading?: string;
  items: NavDropdownItem[];
}

interface Props {
  label: string;
  sections: NavDropdownSection[];
  width?: "narrow" | "wide";  // wide = 2 columns
}

// Click-to-open dropdown with click-outside + Escape to close.
// Accessible: button has aria-expanded, items are focusable links.
export default function NavDropdown({ label, sections, width = "narrow" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panelWidth = width === "wide" ? "w-[420px]" : "w-56";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${open ? "bg-muted/60" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute left-0 top-full mt-1 ${panelWidth} rounded-lg border border-border bg-card shadow-xl p-2 z-40`}
        >
          <div className={width === "wide" ? "grid grid-cols-2 gap-1" : "space-y-0.5"}>
            {sections.map((section, si) => (
              <div key={si} className={width === "wide" && section.heading ? "col-span-2" : ""}>
                {section.heading && (
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1">
                    {section.heading}
                  </div>
                )}
                <div className={width === "wide" ? "grid grid-cols-2 gap-1" : "space-y-0.5"}>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 group"
                        onClick={() => setOpen(false)}
                      >
                        {Icon && <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground mt-0.5 shrink-0" aria-hidden="true" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            {item.label}
                            {item.badge && (
                              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">{item.badge}</span>
                            )}
                          </div>
                          {item.description && (
                            <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
