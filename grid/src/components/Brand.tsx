// Brand mark — the Voltage "G" monogram + GRIDCENSUS wordmark. Thin wrapper
// around the shared <Logo>. Plain component (no client hooks) so it can be used
// inside both the server Sidebar and the client MobileNav.

import Logo from "./Logo";

export default function Brand() {
  return <Logo size={26} href="/" />;
}
