import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { stripe, planIdForPrice } from "@/lib/stripe";
import type { PlanId } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe webhook receiver. Three jobs:
//   1. Verify the signature so attackers can't forge plan upgrades
//   2. Map the event back to our user_id (via metadata or stripe_customer_id)
//   3. Mirror plan_id + status onto the subscriptions row
//
// Subscribed events (configure in Dashboard -> Webhooks):
//   - checkout.session.completed         (initial paid subscription)
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_failed             (dunning marker — past_due)
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "missing_signature_or_secret" }, { status: 400 });
  }

  // Stripe REQUIRES the raw body for signature verification. Next's req.json()
  // would re-stringify and break the HMAC.
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `invalid_signature: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId =
        (session.metadata?.user_id as string | undefined) ??
        (session.client_reference_id as string | undefined) ??
        null;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

      if (!userId) break;
      // Stamp the customer id on the row early so the rest of the events can
      // resolve user_id even when metadata is missing.
      await db
        .from("subscriptions")
        .upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_sub_id: subscriptionId,
            status: "active",
          },
          { onConflict: "user_id" }
        );
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (!userId) break;

      const firstItem = sub.items.data[0];
      const priceId = firstItem?.price.id ?? null;
      const planId: PlanId = planIdForPrice(priceId) ?? "free";
      // Stripe SDK v18 moved current_period_end from the Subscription object
      // onto the SubscriptionItem. Older shapes still expose it at the top.
      const periodEndUnix =
        (firstItem as unknown as { current_period_end?: number | null })?.current_period_end ??
        (sub as unknown as { current_period_end?: number | null }).current_period_end ??
        null;
      const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

      await db
        .from("subscriptions")
        .upsert(
          {
            user_id: userId,
            plan_id: planId,
            status: sub.status,
            stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
            stripe_sub_id: sub.id,
            current_period_end: periodEnd,
            cancel_at_period_end: !!sub.cancel_at_period_end,
          },
          { onConflict: "user_id" }
        );
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserId(sub);
      if (!userId) break;
      await db
        .from("subscriptions")
        .update({
          plan_id: "free",
          status: "canceled",
          stripe_sub_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
        })
        .eq("user_id", userId);
      break;
    }

    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      // SDK v18 moved Invoice.subscription onto invoice line items + a new
      // parent.subscription_details. Reach into both shapes.
      const looseInv = inv as unknown as {
        subscription?: string | { id: string } | null;
        parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
      };
      const rawSub =
        looseInv.subscription ??
        looseInv.parent?.subscription_details?.subscription ??
        null;
      const subId = typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;
      if (!subId) break;
      // Flip to past_due — billing.ts ACTIVE_STATUSES still treats this as
      // entitled for one grace period before Stripe retries deplete.
      await db
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_sub_id", subId);
      break;
    }

    default:
      // Ignore everything else; Stripe sends a lot of events we don't care
      // about and acknowledging them with 200 stops the retry loop.
      break;
  }

  return NextResponse.json({ received: true });
}

// Try metadata first (set during checkout), fall back to stripe_customer_id
// lookup so updates triggered from the Customer Portal still resolve.
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id as string | undefined;
  if (fromMeta) return fromMeta;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  if (!customerId) return null;
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}
