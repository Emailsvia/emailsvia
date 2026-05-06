import "server-only";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Outbound webhooks. Users add a URL + secret in /app/webhooks; we POST
// JSON payloads to that URL on user-relevant events (reply received,
// reply classified, recipient unsubscribed, campaign finished).
//
// Each delivery is logged to webhook_deliveries so the user can audit
// what we sent + retry failures. Synchronous fire-with-one-retry in v1;
// a queue + exponential backoff is a follow-up if it becomes a hotspot.
//
// Signature: every request carries `EmailsVia-Signature: sha256=<hex>`
// computed as HMAC-SHA256(body, webhook.secret). Standard pattern (same
// shape as Stripe / GitHub) so users can verify with a one-liner.

export type WebhookEvent =
  | "reply.received"
  | "reply.classified"
  | "recipient.unsubscribed"
  | "campaign.finished";

const ALL_EVENTS: WebhookEvent[] = [
  "reply.received",
  "reply.classified",
  "recipient.unsubscribed",
  "campaign.finished",
];

export function isWebhookEvent(s: unknown): s is WebhookEvent {
  return typeof s === "string" && (ALL_EVENTS as string[]).includes(s);
}

// 32-byte URL-safe secret. Returned to the user once at creation in
// /app/webhooks; stored verbatim for HMAC signing (no need to hash —
// it's a shared secret, not a credential they authenticate to us with).
export function generateWebhookSecret(): string {
  return "whsec_" + crypto.randomBytes(24).toString("base64url");
}

export function signPayload(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// Fire all matching webhooks for an event. Best-effort — never throws.
// A delivery row is recorded even on failure so the UI shows the
// failure + a retry button (future feature).
export async function dispatch(
  db: SupabaseClient,
  args: {
    user_id: string;
    event_type: WebhookEvent;
    event_id: string;            // stable id used for delivery dedup (eg reply.id)
    payload: Record<string, unknown>;
  }
): Promise<{ fired: number; succeeded: number }> {
  // Find all active webhooks for this user that subscribe to this event.
  const { data: hooks } = await db
    .from("webhooks")
    .select("id, url, secret, events")
    .eq("user_id", args.user_id)
    .eq("active", true);
  if (!hooks || hooks.length === 0) return { fired: 0, succeeded: 0 };
  const matching = hooks.filter((h) =>
    Array.isArray(h.events) && h.events.includes(args.event_type)
  );
  if (matching.length === 0) return { fired: 0, succeeded: 0 };

  const body = JSON.stringify({
    event: args.event_type,
    event_id: args.event_id,
    delivered_at: new Date().toISOString(),
    data: args.payload,
  });

  let succeeded = 0;
  for (const hook of matching) {
    // Insert the delivery row first; UNIQUE (webhook_id, event_id) gives
    // us idempotency — if the same event fires twice, only the first
    // attempt is recorded + delivered.
    const { error: insErr } = await db
      .from("webhook_deliveries")
      .insert({
        webhook_id: hook.id,
        user_id: args.user_id,
        event_type: args.event_type,
        event_id: args.event_id,
        payload: JSON.parse(body),
        status: "pending",
        attempts: 0,
      });
    if (insErr) {
      // Duplicate (already delivered or in-flight) → skip silently.
      continue;
    }
    const sig = signPayload(body, hook.secret);
    const result = await deliverOnce(hook.url, body, sig);
    succeeded += result.ok ? 1 : 0;
    await db
      .from("webhook_deliveries")
      .update({
        status: result.ok ? "succeeded" : "failed",
        attempts: 1,
        http_status: result.status,
        response_excerpt: result.body.slice(0, 500),
        delivered_at: new Date().toISOString(),
      })
      .eq("webhook_id", hook.id)
      .eq("event_id", args.event_id);
    if (result.ok) {
      // Bump last_used_at separately so a failing hook doesn't get the
      // stamp (lets the user spot dead webhooks at a glance).
      await db.from("webhooks").update({ last_used_at: new Date().toISOString() }).eq("id", hook.id);
    }
  }
  return { fired: matching.length, succeeded };
}

async function deliverOnce(
  url: string,
  body: string,
  signature: string
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "EmailsVia-Webhook/1.0",
        "EmailsVia-Signature": signature,
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : String(e),
    };
  }
}
