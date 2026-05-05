import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Sends a Supabase password-reset email. Always returns ok=true regardless
// of whether the email exists, so this route can't be used to enumerate
// account holders.
export async function POST(req: NextRequest) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: true });
  }
  const sb = await supabaseUser();
  await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_URL ?? ""}/auth/callback?next=/app`,
  });
  return NextResponse.json({ ok: true });
}
