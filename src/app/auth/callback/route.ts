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
  const { path, query } = splitNext(next);
  dest.pathname = path;
  dest.search = query;
  return NextResponse.redirect(dest);
}

// Split `next` into a validated path + its query string. The path is run
// through the open-redirect guard; the query is only preserved when the path
// is trusted (otherwise we drop both and fall back to /app). This lets us
// carry things like `?checkout=growth` through email-confirmation / OAuth
// round-trips without ever honoring an attacker-supplied absolute URL.
function splitNext(value: string): { path: string; query: string } {
  if (typeof value !== "string") return { path: "/app", query: "" };
  const qIdx = value.indexOf("?");
  const rawPath = qIdx === -1 ? value : value.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? "" : value.slice(qIdx);
  const path = safeNext(rawPath);
  return { path, query: path === rawPath ? rawQuery : "" };
}

// Allow only same-origin paths starting with a single slash. Rejects
// protocol-relative (`//evil.com/x`), absolute URLs (`https://evil.com`),
// and any value that doesn't begin with "/". Defends against open-redirect
// abuse when the `next` param flows through a tampered link.
function safeNext(value: string): string {
  if (typeof value !== "string") return "/app";
  if (!value.startsWith("/")) return "/app";
  if (value.startsWith("//")) return "/app"; // protocol-relative
  if (value.startsWith("/\\")) return "/app"; // backslash variant
  return value;
}
