import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-app alerts feed for the signed-in user. Replaces email-based ops
// notifications: instead of waiting for Postmark to deliver "your Gmail
// disconnected", AppShell renders a banner that links straight to the
// remediation page.
//
// Sources we surface today:
//   - subscriptions.suspended_at  → operator suspended this tenant
//   - subscriptions.status = past_due / unpaid → Stripe charge failed
//   - subscriptions.cancel_at_period_end → user opted out, plan ends soon
//   - senders.oauth_status != 'ok' → Gmail OAuth revoked / pending

export type AlertSeverity = "error" | "warn" | "info";
export type Alert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  href: string;
  cta: string;
};

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const alerts: Alert[] = [];

  const { data: sub } = await db
    .from("subscriptions")
    .select("plan_id, status, suspended_at, cancel_at_period_end, current_period_end")
    .eq("user_id", u.id)
    .maybeSingle();

  if (sub?.suspended_at) {
    alerts.push({
      id: "tenant_suspended",
      severity: "error",
      title: "Account suspended",
      body: "Sending is paused on your account. Contact support to resolve.",
      href: "mailto:support@emailsvia.com",
      cta: "Contact support",
    });
  }

  if (sub?.status === "past_due" || sub?.status === "unpaid") {
    alerts.push({
      id: "payment_failed",
      severity: "error",
      title: "Payment failed",
      body: "Stripe couldn't charge your card. Update payment to keep paid features.",
      href: "/app/billing",
      cta: "Update payment",
    });
  }

  if (sub?.cancel_at_period_end && sub.current_period_end) {
    const ends = new Date(sub.current_period_end);
    if (ends.getTime() > Date.now()) {
      alerts.push({
        id: "cancel_pending",
        severity: "warn",
        title: "Subscription canceling",
        body: `Your plan ends ${ends.toLocaleDateString()}. You'll drop to Free.`,
        href: "/app/billing",
        cta: "Manage billing",
      });
    }
  }

  // Sender OAuth state — surface if any are revoked / pending.
  const { data: senders } = await db
    .from("senders")
    .select("id, label, email, oauth_status")
    .eq("user_id", u.id)
    .neq("oauth_status", "ok");
  if (senders && senders.length > 0) {
    const revoked = senders.filter((s) => s.oauth_status === "revoked");
    const pending = senders.filter((s) => s.oauth_status === "pending");
    if (revoked.length > 0) {
      alerts.push({
        id: "sender_revoked",
        severity: "error",
        title:
          revoked.length === 1
            ? `${revoked[0].email} disconnected`
            : `${revoked.length} senders disconnected`,
        body:
          revoked.length === 1
            ? "Google revoked OAuth. Reconnect to resume campaigns."
            : "Google revoked OAuth on multiple senders. Reconnect to resume.",
        href: "/app/senders",
        cta: "Reconnect",
      });
    }
    if (pending.length > 0) {
      alerts.push({
        id: "sender_pending",
        severity: "warn",
        title:
          pending.length === 1
            ? `${pending[0].email} needs attention`
            : `${pending.length} senders pending`,
        body: "Finish connecting these senders before they can send mail.",
        href: "/app/senders",
        cta: "Open senders",
      });
    }
  }

  return NextResponse.json({ alerts });
}
