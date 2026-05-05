import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST() {
  const sb = await supabaseUser();
  await sb.auth.signOut();
  return NextResponse.json({ ok: true });
}
