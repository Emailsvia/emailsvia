import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

// Supabase OAuth + email-confirmation redirect target. Exchanges the ?code
// for a session cookie, then sends the user to ?next.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/app";

  if (code) {
    const sb = await supabaseUser();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "oauth_exchange_failed");
      return NextResponse.redirect(url);
    }
  }

  const dest = req.nextUrl.clone();
  dest.pathname = next.startsWith("/") ? next : "/app";
  dest.search = "";
  return NextResponse.redirect(dest);
}
