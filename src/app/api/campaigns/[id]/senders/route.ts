import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { getPlan } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutSchema = z.object({
  sender_ids: z.array(z.string().uuid()).max(20),
});

// Returns the rotation set (senders attached to this campaign) plus the
// caller's plan ceiling so the UI can disable "Add" when the cap is hit.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const { data, error } = await db
    .from("campaign_senders")
    .select("sender_id, weight, sender:senders(id, label, email, from_name, auth_method, oauth_status, warmup_enabled, warmup_started_at)")
    .eq("campaign_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const plan = await getPlan(db, u.id);
  return NextResponse.json({
    rotation: data ?? [],
    sender_limit: plan.sender_limit,
    plan_id: plan.id,
  });
}

// Replaces the rotation set in one call (simpler than per-row CRUD). The
// plan's sender_limit caps how many distinct senders may be attached.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_sender_ids" }, { status: 400 });
  }
  const db = await supabaseUser();
  const plan = await getPlan(db, u.id);

  const ids = Array.from(new Set(parsed.data.sender_ids));
  if (ids.length > plan.sender_limit) {
    return NextResponse.json(
      {
        error: "sender_limit_exceeded",
        message: `Your ${plan.name} plan allows up to ${plan.sender_limit} sender${plan.sender_limit === 1 ? "" : "s"} per campaign.`,
      },
      { status: 402 }
    );
  }

  // Verify every sender id belongs to this user (RLS would also enforce
  // this on insert, but a clean 400 is friendlier than a generic RLS error).
  if (ids.length > 0) {
    const { data: owned } = await db
      .from("senders")
      .select("id")
      .in("id", ids);
    const ownedIds = new Set((owned ?? []).map((r) => r.id));
    const stranger = ids.find((s) => !ownedIds.has(s));
    if (stranger) return NextResponse.json({ error: "sender_not_found" }, { status: 400 });
  }

  // Wipe + re-insert. The set is small (<= 10) so this is cheaper than
  // diff-then-patch and avoids partial-update headaches.
  await db.from("campaign_senders").delete().eq("campaign_id", id);
  if (ids.length > 0) {
    const rows = ids.map((sender_id) => ({
      campaign_id: id,
      sender_id,
      user_id: u.id,
      weight: 1,
    }));
    const { error } = await db.from("campaign_senders").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, attached: ids.length });
}
