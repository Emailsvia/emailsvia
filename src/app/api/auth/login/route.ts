import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }
  const sb = await supabaseUser();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
