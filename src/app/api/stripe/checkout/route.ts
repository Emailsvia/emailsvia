import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe, stripePriceFor } from "@/lib/stripe";
import { requestOrigin } from "@/lib/tokens";
import type { PlanId } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  plan: z.enum(["starter", "growth", "scale"]),
});

// Creates a Stripe Checkout Session for the requested paid tier and returns
// the redirect URL. The client navigates to it; on completion Stripe sends
// the user back to /billing?status=success and fires a webhook that flips
// the subscription row to the new plan.
export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

  const planId = parsed.data.plan as PlanId;
  const priceId = stripePriceFor(planId);
  if (!priceId) {
    return NextResponse.json({ error: `no_price_for_${planId}` }, { status: 500 });
  }

  // Reuse the customer id if we've already created one for this user — keeps
  // their saved cards / tax ids attached across upgrades.
  const db = supabaseAdmin();
  const { data: sub } = await db
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", u.id)
    .maybeSingle();

  // Derive the return origin from the live request, not APP_URL — a stale
  // APP_URL must never strand a paying user on localhost after checkout.
  const origin = requestOrigin(req);
  const successUrl = `${origin}/app/billing?status=success`;
  const cancelUrl = `${origin}/app/billing?status=cancelled`;

  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: sub?.stripe_customer_id ?? undefined,
      customer_email: sub?.stripe_customer_id ? undefined : (u.email ?? undefined),
      // Stripe Tax handles VAT/GST/sales-tax automatically (Phase 1.4 plan
      // calls this out explicitly). Enable in Dashboard -> Settings -> Tax.
      automatic_tax: { enabled: true },
      // Stamp our own user id onto the session so the webhook can resolve
      // back to a Supabase user even if the customer id wasn't pre-linked.
      client_reference_id: u.id,
      metadata: { user_id: u.id, plan_id: planId },
      subscription_data: {
        metadata: { user_id: u.id, plan_id: planId },
      },
      // Show the promo-code box. A 100%-off code (e.g. "FREE") drops the
      // total to $0, so don't force a card in that case.
      allow_promotion_codes: true,
      payment_method_collection: "if_required",
    });

    if (!session.url) {
      return NextResponse.json({ error: "stripe_no_session_url" }, { status: 500 });
    }
    return NextResponse.json({ url: session.url });
  } catch (e) {
    // Surface the real Stripe error (e.g. tax origin not configured, bad
    // price id) instead of letting the route 500 with an opaque page — the
    // billing UI shows whatever message we return here.
    const msg = e instanceof Error ? e.message : "stripe_checkout_failed";
    console.error("[stripe/checkout] session create failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
