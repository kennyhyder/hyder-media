"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { LayoutDashboard, Settings, Shield, LogOut, ChevronDown, Bell, Star, BookOpen, TrendingUp } from "lucide-react";
import type { TierKey } from "@/lib/tiers";

interface Props {
  email: string;
  tier: TierKey;
  isAdmin: boolean;
}

export default function UserMenu({ email, tier, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initial = (email[0] || "?").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-full border border-border bg-card hover:bg-muted p-1 pl-2 pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500"
        aria-label="Account menu"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold hidden md:inline max-w-[120px] truncate">{email}</span>
        <span className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-500 text-xs font-bold flex items-center justify-center md:hidden">{initial}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-card shadow-lg p-1 z-40">
          <div className="px-3 py-2 border-b border-border/40">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="text-sm font-medium truncate">{email}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 uppercase">{tier} plan</div>
          </div>
          <MenuItem href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />}>Dashboard</MenuItem>
          <MenuItem href="/bets" icon={<TrendingUp className="h-4 w-4" />}>
            Bet Tracker {tier !== "elite" && <span className="text-[9px] text-amber-500 ml-auto">Elite</span>}
          </MenuItem>
          {(tier === "pro" || tier === "elite") && (
            <MenuItem href="/alerts" icon={<Bell className="h-4 w-4" />}>Alerts</MenuItem>
          )}
          <MenuItem href="/sports/movers" icon={<Star className="h-4 w-4" />}>Top movers</MenuItem>
          <MenuItem href="/learn" icon={<BookOpen className="h-4 w-4" />}>Learn</MenuItem>
          <MenuItem href="/settings" icon={<Settings className="h-4 w-4" />}>Settings</MenuItem>
          {isAdmin && (
            <MenuItem href="/admin" icon={<Shield className="h-4 w-4 text-rose-500" />}>Admin</MenuItem>
          )}
          <form action="/api/auth/signout" method="post" className="border-t border-border/40 mt-1 pt-1">
            <button type="submit" className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 rounded text-rose-500">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuItem({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50 rounded">
      <span className="text-muted-foreground" aria-hidden="true">{icon}</span>
      <span className="flex items-center flex-1 gap-2">{children}</span>
    </Link>
  );
}
