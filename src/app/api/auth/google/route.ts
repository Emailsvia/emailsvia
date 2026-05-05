import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Kicks off the Supabase-hosted Google OAuth flow for *app login*. This is
// distinct from sender-Gmail OAuth (Phase 1.3) which authorizes mail-sending
// scopes per connected mailbox.
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/app";
  const sb = await supabaseUser();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.APP_URL ?? req.nextUrl.origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) {
    return NextResponse.json({ error: error?.message ?? "oauth_init_failed" }, { status: 500 });
  }
  return NextResponse.redirect(data.url);
}
