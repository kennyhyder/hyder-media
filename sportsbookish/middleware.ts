import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { checkRedirect } from "@/lib/redirects";

export async function middleware(request: NextRequest) {
  // Redirect lookup runs FIRST — saves auth/cookie work on hits to dead URLs.
  // Returns null when no redirect applies, in which case we fall through to
  // the normal Supabase session-refresh flow.
  const redirect = await checkRedirect(request);
  if (redirect) return redirect;
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
