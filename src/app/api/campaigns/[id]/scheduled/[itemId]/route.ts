import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/auth-server";
import { recordEvent } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Approve (send at the next tick, through the normal gates) or skip a
// scheduled follow-up to someone who already replied.
const Body = z.object({ action: z.enum(["approve", "skip"]) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, itemId } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "action must be approve or skip" }, { status: 400 });
  const db = await supabaseUser();
  const now = new Date().toISOString();
  const patch =
    parsed.data.action === "approve"
      ? { status: "scheduled", approved_at: now, due_at: now }
      : { status: "cancelled", cancel_reason: "skipped_by_you" };
  const { data: item, error } = await db
    .from("scheduled_followups")
    .update(patch)
    .eq("id", itemId)
    .eq("campaign_id", id)
    .in("status", ["needs_approval", "scheduled"])
    .select("id, user_id, campaign_id, recipient_id, kind")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "It was already sent, skipped or cancelled." }, { status: 409 });
  if (parsed.data.action === "approve") {
    // A finished campaign isn't looked at by tick; reopen it to send this.
    await db.from("campaigns").update({ status: "running" }).eq("id", id).eq("status", "done");
  }
  // Server-written log; the row was just updated through RLS, so it's theirs.
  await recordEvent(supabaseAdmin(), {
    user_id: item.user_id,
    campaign_id: item.campaign_id,
    recipient_id: item.recipient_id,
    type: "followup_decided",
    data: { outcome: parsed.data.action === "approve" ? "approved" : "skipped", kind: item.kind },
  });
  return NextResponse.json({ ok: true });
}
