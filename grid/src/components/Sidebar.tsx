// Desktop sidebar (server component). Fixed 248px rail on screens >=1024px.
// Renders the brand + the shared <NavContent>. Hidden below lg (the MobileNav
// top bar + drawer take over there).
//
// SEO: the nav links live in <NavContent>; they render unconditionally as real
// <a href> in the SSR HTML regardless of the client active-state highlight.

import Brand from "./Brand";
import NavContent from "./NavContent";

export default function Sidebar() {
  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r lg:flex"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex h-14 items-center border-b px-4" style={{ borderColor: "var(--border)" }}>
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        <NavContent />
      </div>
    </aside>
  );
}
