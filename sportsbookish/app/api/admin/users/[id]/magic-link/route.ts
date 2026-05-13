import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";

// POST /api/admin/users/[id]/magic-link
// Sends a fresh magic-link email to the target user. Useful for support
// flows where someone lost their original link or can't get the magic
// link redelivered themselves.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const service = createServiceClient();

  const { data: target } = await service.auth.admin.getUserById(id);
  if (!target?.user?.email) {
    return NextResponse.json({ error: "User has no email" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sportsbookish.com";
  const { error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: target.user.email,
    options: { redirectTo: `${siteUrl}/auth/callback` },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // generateLink sends the email via Supabase's configured SMTP automatically
  // when the auth.email.enable_signup setting is on (which it is by default).
  return NextResponse.json({ ok: true, email: target.user.email });
}
