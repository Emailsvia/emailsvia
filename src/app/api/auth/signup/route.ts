import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

const PAID_PLANS = new Set(["starter", "growth", "scale"]);

export async function POST(req: NextRequest) {
  const { email, password, plan } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    plan?: string;
  };
  if (!email || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }
  // Paid signups carry the chosen plan through the email-confirmation round
  // trip so they land on the billing page with checkout pre-armed. Free /
  // unknown plans just go to the app.
  const next =
    plan && PAID_PLANS.has(plan) ? `/app/billing?checkout=${plan}` : "/app";
  const sb = await supabaseUser();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.APP_URL ?? ""}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // If email confirmation is OFF in Supabase, signUp returns a session and
  // the user is signed in. If it's ON, no session yet — they need to click
  // the confirmation email.
  return NextResponse.json({
    ok: true,
    needsConfirmation: !data.session,
  });
}
