import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("replies")
    .select(`
      id, from_email, subject, snippet, body_text, body_html, received_at, created_at,
      intent, intent_confidence,
      recipient:recipients(id, name, company),
      campaign:campaigns(id, name)
    `)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ replies: data ?? [] });
}
