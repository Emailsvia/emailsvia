import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/auth-server";
import { applyIntentActions } from "@/lib/reply-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTENTS = ["interested", "not_now", "question", "unsubscribe", "wrong_person", "left_company", "ooo", "bounce", "other"] as const;

// One reply with everything the drawer needs: the inbound message, what we
// sent back from EmailsVia, and the recipient's sequence state. Opening it
// marks it read.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data: reply, error } = await db
    .from("replies")
    .select(`
      id, from_email, subject, snippet, body_text, body_html, received_at, created_at,
      intent, intent_confidence, intent_source, is_auto_reply, read_at, handled_at, ai_draft,
      recipient:recipients(id, name, company, email, status, stop_reason),
      campaign:campaigns(id, name)
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: sent } = await db
    .from("reply_messages")
    .select("id, subject, body, sent_at")
    .eq("reply_id", id)
    .order("sent_at", { ascending: true });

  if (!reply.read_at) {
    const readAt = new Date().toISOString();
    await db.from("replies").update({ read_at: readAt }).eq("id", id);
    reply.read_at = readAt;
  }

  return NextResponse.json({ reply, sent: sent ?? [] });
}

const PatchSchema = z.object({
  handled: z.boolean().optional(),
  read: z.boolean().optional(),
  intent: z.enum(INTENTS).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const db = await supabaseUser();

  const update: Record<string, unknown> = {};
  if (parsed.data.handled !== undefined) update.handled_at = parsed.data.handled ? new Date().toISOString() : null;
  if (parsed.data.read !== undefined) update.read_at = parsed.data.read ? new Date().toISOString() : null;
  if (parsed.data.intent) {
    update.intent = parsed.data.intent;
    update.intent_source = "manual";
    update.intent_confidence = null;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "no_fields" }, { status: 400 });

  // RLS scopes this to the caller's own replies; zero rows = not theirs.
  const { data, error } = await db.from("replies").update(update).eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const actions = parsed.data.intent
    ? await applyIntentActions(supabaseAdmin(), id, parsed.data.intent, "manual")
    : [];
  return NextResponse.json({ ok: true, actions });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { error } = await db.from("replies").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
