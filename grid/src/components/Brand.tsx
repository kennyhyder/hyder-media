// Brand mark — "◆ GRIDCENSUS". Plain component (no client hooks) so it can be
// used inside both the server Sidebar and the client MobileNav.

export default function Brand() {
  return (
    <a href="/" className="flex items-center gap-2 font-bold tracking-tight" style={{ color: "var(--text)" }}>
      <span className="brand-diamond text-lg leading-none" aria-hidden="true">
        &#9670;
      </span>
      <span className="text-[15px] uppercase tracking-[0.14em]">GridCensus</span>
    </a>
  );
}
