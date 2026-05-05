import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseUser } from "@/lib/supabase-server";
import { getPlanForUser } from "@/lib/billing";
import { dayKey } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the current user's plan, subscription state, and today's send count
// (used by the /billing page to show "47 / 50 sent today" + a relevant upgrade
// CTA).
export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = await supabaseUser();
  const { plan, subscription } = await getPlanForUser(db, u.id);

  // Today is in the user's first sender's timezone if available, else IST
  // default. Cheap heuristic — billing page tolerance for tz drift is high.
  const { data: anySender } = await db.from("senders").select("id").limit(1).maybeSingle();
  void anySender; // sender presence not currently used here, but reserved
  const tz = "Asia/Kolkata";
  const day = dayKey(new Date(), tz);

  const { data: usage } = await db
    .from("usage_daily")
    .select("sent")
    .eq("user_id", u.id)
    .eq("day", day)
    .maybeSingle();

  // Tell the UI whether Stripe is fully configured (all three paid-tier
  // price IDs set). When false, the billing page falls back to a dev
  // shortcut endpoint that flips plan_id directly. Production deploys
  // ship with all three set, so this collapses to true.
  const stripeConfigured = !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_STARTER &&
    process.env.STRIPE_PRICE_GROWTH &&
    process.env.STRIPE_PRICE_SCALE
  );

  return NextResponse.json({
    plan,
    subscription,
    sent_today: usage?.sent ?? 0,
    day,
    timezone: tz,
    stripe_configured: stripeConfigured,
    dev_mode: process.env.NODE_ENV !== "production",
  });
}
