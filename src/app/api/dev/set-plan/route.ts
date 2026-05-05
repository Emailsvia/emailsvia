import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEV ONLY. Lets the billing UI flip the caller's plan_id without going
// through Stripe so we can test feature gates locally without setting up
// products + webhooks. Returns 404 in production — even if someone curls
// it directly, the route doesn't exist on a prod build.
//
// In production the upgrade flow goes through /api/stripe/checkout →
// Stripe Checkout → webhook → subscriptions.plan_id. This endpoint is
// the local-dev shortcut only.

const Schema = z.object({
  plan: z.enum(["free", "starter", "growth", "scale"]),
});

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("subscriptions")
    .update({ plan_id: parsed.data.plan, status: "active" })
    .eq("user_id", u.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plan: parsed.data.plan });
}
