// Server-side user-agent helpers. iOS detection is used to gate iOS-only
// affiliate offers (e.g. Polymarket — the regulated US app is iOS-only as of
// 2026-06; desktop signups are explicitly not in the affiliate offer).
//
// Usage in a server component:
//   import { headers } from "next/headers";
//   import { isIOSUserAgent } from "@/lib/device";
//   const ua = (await headers()).get("user-agent");
//   const ios = isIOSUserAgent(ua);

const IOS_RE = /iPhone|iPad|iPod/i;
// iPadOS 13+ reports as Mac with touch — disambiguate via "Mobile" hint.
const IPAD_DESKTOP_RE = /Macintosh.*Mobile/i;

export function isIOSUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  if (IOS_RE.test(ua)) return true;
  if (IPAD_DESKTOP_RE.test(ua)) return true;
  return false;
}
