import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?view=inbox (default): not yet marked done, auto-replies hidden
// ?view=done: marked done   ?view=auto: out-of-office / auto-responders
// ?view=all: everything
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const view = req.nextUrl.searchParams.get("view") ?? "inbox";
  const db = await supabaseUser();
  let q = db
    .from("replies")
    .select(`
      id, from_email, subject, snippet, body_text, body_html, received_at, created_at,
      intent, intent_confidence, intent_source, is_auto_reply, read_at, handled_at,
      recipient:recipients(id, name, company),
      campaign:campaigns(id, name)
    `);
  if (view === "inbox") q = q.is("handled_at", null).eq("is_auto_reply", false);
  else if (view === "done") q = q.not("handled_at", "is", null);
  else if (view === "auto") q = q.eq("is_auto_reply", true);
  const { data, error } = await q
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ replies: data ?? [] });
}
