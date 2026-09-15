import "server-only";
import crypto from "crypto";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import type { SupabaseClient } from "@supabase/supabase-js";

// Outbound webhooks. Users add a URL + secret in /app/webhooks; we POST
// JSON payloads to that URL on user-relevant events.
//
// Delivery: every event is recorded in webhook_deliveries (UNIQUE
// (webhook_id, event_id) makes firing idempotent). Events from interactive
// or low-volume paths deliver immediately; events from the send loop are
// only queued so a slow endpoint can't slow sending. Failed and queued
// deliveries are retried by /api/cron/webhooks with exponential backoff
// (RETRY_SCHEDULE_MIN) until they succeed or are marked "exhausted".
//
// Signature: every request carries `EmailsVia-Signature: sha256=<hex>`
// computed as HMAC-SHA256(body, webhook.secret). Standard pattern (same
// shape as Stripe / GitHub) so users can verify with a one-liner.

export type WebhookEvent =
  | "reply.received"
  | "reply.classified"
  | "recipient.unsubscribed"
  | "campaign.finished"
  | "email.sent"
  | "email.bounced"
  | "sequence.stopped"
  | "campaign.paused";

const ALL_EVENTS: WebhookEvent[] = [
  "reply.received",
  "reply.classified",
  "recipient.unsubscribed",
  "campaign.finished",
  "email.sent",
  "email.bounced",
  "sequence.stopped",
  "campaign.paused",
];

export function isWebhookEvent(s: unknown): s is WebhookEvent {
  return typeof s === "string" && (ALL_EVENTS as string[]).includes(s);
}

// Minutes to wait before attempt 2, 3, … (attempt 1 is immediate or queued).
// ~19h of retrying in total, then the delivery is exhausted.
const RETRY_SCHEDULE_MIN = [1, 5, 30, 120, 360, 720];

// 32-byte URL-safe secret. Returned to the user once at creation in
// /app/webhooks; stored verbatim for HMAC signing (no need to hash —
// it's a shared secret, not a credential they authenticate to us with).
export function generateWebhookSecret(): string {
  return "whsec_" + crypto.randomBytes(24).toString("base64url");
}

export function signPayload(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// Record an event for every matching webhook and (unless `queueOnly`) try
// to deliver it now. Best-effort: never throws.
export async function dispatch(
  db: SupabaseClient,
  args: {
    user_id: string;
    event_type: WebhookEvent;
    event_id: string;            // stable id used for delivery dedup (eg reply.id)
    payload: Record<string, unknown>;
  },
  opts: { queueOnly?: boolean } = {}
): Promise<{ fired: number; succeeded: number }> {
  try {
    const { data: hooks } = await db
      .from("webhooks")
      .select("id, url, secret, events")
      .eq("user_id", args.user_id)
      .eq("active", true);
    const matching = (hooks ?? []).filter((h) => Array.isArray(h.events) && h.events.includes(args.event_type));
    if (matching.length === 0) return { fired: 0, succeeded: 0 };

    const envelope = {
      event: args.event_type,
      event_id: args.event_id,
      created_at: new Date().toISOString(),
      data: args.payload,
    };

    let succeeded = 0;
    for (const hook of matching) {
      // UNIQUE (webhook_id, event_id): a duplicate insert means this event
      // was already recorded for this hook, so skip it.
      const { data: row, error: insErr } = await db
        .from("webhook_deliveries")
        .insert({
          webhook_id: hook.id,
          user_id: args.user_id,
          event_type: args.event_type,
          event_id: args.event_id,
          payload: envelope,
          status: "pending",
          attempts: 0,
          // Delivered inline below: keep the cron from picking the same row
          // up concurrently. Queued rows are due immediately.
          next_attempt_at: new Date(Date.now() + (opts.queueOnly ? 0 : CLAIM_MS)).toISOString(),
        })
        .select("id")
        .single();
      if (insErr || !row) continue;
      if (opts.queueOnly) continue;
      const ok = await attemptDelivery(db, { id: row.id, attempts: 0, payload: envelope }, hook);
      if (ok) succeeded++;
    }
    return { fired: matching.length, succeeded };
  } catch {
    return { fired: 0, succeeded: 0 };
  }
}

// Cron side: deliver everything due. Returns counts for the cron response.
export async function deliverDue(
  db: SupabaseClient,
  opts: { limit?: number; budgetMs?: number } = {}
): Promise<{ attempted: number; succeeded: number; exhausted: number }> {
  const started = Date.now();
  const { data: due } = await db
    .from("webhook_deliveries")
    .select("id, user_id, webhook_id, attempts, payload, next_attempt_at, webhook:webhooks(id, user_id, url, secret, active)")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(opts.limit ?? 100);
  let attempted = 0;
  let succeeded = 0;
  let exhausted = 0;
  for (const d of due ?? []) {
    if (Date.now() - started > (opts.budgetMs ?? 40_000)) break;
    const hook = (Array.isArray(d.webhook) ? d.webhook[0] : d.webhook) as
      | { id: string; user_id: string; url: string; secret: string; active: boolean }
      | null;
    // The delivery row must belong to the webhook's owner. Rows are only
    // written by the server, but never let a mismatched row send one
    // tenant's payload signed with another tenant's secret.
    if (!hook || !hook.active || hook.user_id !== d.user_id) {
      await db
        .from("webhook_deliveries")
        .update({ status: "exhausted", next_attempt_at: null, response_excerpt: "webhook disabled, deleted or not owned" })
        .eq("id", d.id);
      exhausted++;
      continue;
    }
    // Claim: push next_attempt_at out first, conditional on the value we
    // read. A second cron run (or a run killed mid-request) can't deliver
    // the same row twice, and a hung endpoint can't pin the queue head.
    const { data: claimed } = await db
      .from("webhook_deliveries")
      .update({ next_attempt_at: new Date(Date.now() + CLAIM_MS).toISOString() })
      .eq("id", d.id)
      .eq("status", "pending")
      .eq("next_attempt_at", d.next_attempt_at)
      .select("id");
    if (!claimed?.length) continue;
    attempted++;
    const ok = await attemptDelivery(db, { id: d.id, attempts: d.attempts, payload: d.payload }, hook);
    if (ok) succeeded++;
    else if (d.attempts + 1 > RETRY_SCHEDULE_MIN.length) exhausted++;
  }
  return { attempted, succeeded, exhausted };
}

// Manual "redeliver" from the UI. Service-role client + explicit owner
// check (webhook_deliveries is read-only for users).
export async function redeliver(admin: SupabaseClient, userId: string, deliveryId: string): Promise<boolean> {
  const { data: d } = await admin
    .from("webhook_deliveries")
    .select("id, user_id, payload, webhook:webhooks(id, user_id, url, secret, active)")
    .eq("id", deliveryId)
    .eq("user_id", userId)
    .maybeSingle();
  const hook = (Array.isArray(d?.webhook) ? d?.webhook[0] : d?.webhook) as
    | { id: string; user_id: string; url: string; secret: string; active: boolean }
    | null;
  if (!d || !hook || hook.user_id !== userId) return false;
  return attemptDelivery(admin, { id: d.id, attempts: 0, payload: d.payload }, hook);
}

async function attemptDelivery(
  db: SupabaseClient,
  delivery: { id: string; attempts: number; payload: unknown },
  hook: { id: string; url: string; secret: string }
): Promise<boolean> {
  // Re-stamp delivered_at in the body so receivers can see retry time;
  // the signature always covers exactly the bytes sent.
  const body = JSON.stringify({ ...(delivery.payload as object), delivered_at: new Date().toISOString() });
  const result = await deliverOnce(hook.url, body, signPayload(body, hook.secret));
  const attempts = delivery.attempts + 1;
  const retryIn = RETRY_SCHEDULE_MIN[attempts - 1];
  await db
    .from("webhook_deliveries")
    .update({
      status: result.ok ? "succeeded" : retryIn !== undefined ? "pending" : "exhausted",
      attempts,
      http_status: result.status,
      response_excerpt: result.body.slice(0, 500),
      delivered_at: result.ok ? new Date().toISOString() : null,
      next_attempt_at: result.ok || retryIn === undefined ? null : new Date(Date.now() + retryIn * 60_000).toISOString(),
    })
    .eq("id", delivery.id);
  if (result.ok) {
    // Bump last_used_at separately so a failing hook doesn't get the
    // stamp (lets the user spot dead webhooks at a glance).
    await db.from("webhooks").update({ last_used_at: new Date().toISOString() }).eq("id", hook.id);
  }
  return result.ok;
}

// SSRF guard: webhook URLs are user-supplied and fetched from our servers,
// so refuse anything that resolves to loopback, private, link-local (incl.
// cloud metadata 169.254.169.254), CGNAT, multicast or reserved ranges, in
// every notation (net.BlockList also matches IPv4-mapped IPv6 such as
// ::ffff:7f00:1). Delivery then connects to the exact address that passed
// the check (pinned lookup), so DNS rebinding can't swap it afterwards.
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["::", 96] /* IPv4-compatible */, ["64:ff9b::", 96] /* NAT64 */,
  ["100::", 64], ["2001:db8::", 32], ["2002::", 16] /* 6to4 */, ["fc00::", 7], ["fe80::", 10],
  ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(addr, prefix, "ipv6");

export function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return false;
  return !BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

function devLoopbackAllowed(host: string): boolean {
  return process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

// Validate at save time (fast feedback). Delivery re-checks every address.
export async function assertPublicUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new Error("webhook URL must use https");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (devLoopbackAllowed(host)) return;
  const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some((a) => !isPublicIp(a))) {
    throw new Error("webhook URL must resolve to a public address");
  }
}

const MAX_RESPONSE_BYTES = 2048;
const DELIVERY_TIMEOUT_MS = 8_000;
// How long a claimed delivery is hidden from other runs.
const CLAIM_MS = 2 * 60_000;

function deliverOnce(
  rawUrl: string,
  body: string,
  signature: string
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: boolean; status: number; body: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    // One deadline for connect + headers + body: a slow-dripping endpoint
    // can't hold a worker past DELIVERY_TIMEOUT_MS.
    const timer = setTimeout(() => {
      req?.destroy(new Error("timeout"));
      done({ ok: false, status: 0, body: "timeout" });
    }, DELIVERY_TIMEOUT_MS);

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return done({ ok: false, status: 0, body: "invalid url" });
    }
    const isHttps = url.protocol === "https:";
    if (!isHttps && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      return done({ ok: false, status: 0, body: "webhook URL must use https" });
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const allowLoopback = devLoopbackAllowed(host);

    const lookup: net.LookupFunction = (hostname, options, cb) => {
      dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return (cb as any)(err);
        const list = (addresses as unknown as dns.LookupAddress[]) ?? [];
        const safe = list.filter((a) => allowLoopback || isPublicIp(a.address));
        if (safe.length === 0 || safe.length !== list.length) {
          return (cb as any)(new Error("webhook URL must resolve to a public address"));
        }
        if ((options as dns.LookupAllOptions)?.all) return (cb as any)(null, safe);
        (cb as any)(null, safe[0].address, safe[0].family);
      });
    };

    if (net.isIP(host) && !allowLoopback && !isPublicIp(host)) {
      return done({ ok: false, status: 0, body: "webhook URL must resolve to a public address" });
    }

    const req = (isHttps ? https : http).request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "EmailsVia-Webhook/1.1",
          "EmailsVia-Signature": signature,
        },
        lookup,
        // Redirects are never followed (http.request doesn't), so a 3xx
        // can't bounce us to an internal address; it counts as a failure.
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          if (size < MAX_RESPONSE_BYTES) chunks.push(c.subarray(0, MAX_RESPONSE_BYTES - size));
          size += c.length;
          if (size >= MAX_RESPONSE_BYTES) {
            res.destroy();
            done({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString("utf8") });
          }
        });
        res.on("end", () => done({ ok: status >= 200 && status < 300, status, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", (e) => done({ ok: false, status, body: e.message }));
      }
    );
    req.on("error", (e) => done({ ok: false, status: 0, body: e.message }));
    req.end(body);
  });
}
