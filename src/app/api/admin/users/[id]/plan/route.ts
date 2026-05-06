import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { isAdminUser, logAdminAction } from "@/lib/admin";
import type { PlanId } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLANS: PlanId[] = ["free", "starter", "growth", "scale"];

// Force-change a tenant's plan. This is "operator override" — Stripe is NOT
// touched. Use it for comp accounts, beta access, refunds, etc. The next
// real Stripe event will overwrite the local row, so prefer this only for
// off-Stripe accounts (or comp grants you'll later cancel manually).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me || !isAdminUser(me.id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    plan_id?: string;
    status?: string;
  };
  if (!body.plan_id || !VALID_PLANS.includes(body.plan_id as PlanId)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }
  const status = body.status ?? "active";

  const db = supabaseAdmin();
  const { data: prev } = await db
    .from("subscriptions")
    .select("plan_id, status")
    .eq("user_id", id)
    .maybeSingle();

  // Upsert so users with no subscription row (rare) still get one.
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: id,
      plan_id: body.plan_id,
      status,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await logAdminAction(me.id, "plan.force_change", { type: "user", id }, {
    from: prev,
    to: { plan_id: body.plan_id, status },
  });

  return NextResponse.json({ ok: true });
}
