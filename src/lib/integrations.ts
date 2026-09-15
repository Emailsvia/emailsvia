import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./crypto";
import { appUrl } from "./tokens";
import { getPlanForUser, hasFeature } from "./billing";

// Push labelled replies into the user's CRM / Slack. Called from
// applyIntentActions (service-role client). Best-effort: a failing CRM
// never breaks reply ingestion; the error is stored on the integration row
// and shown in Settings.

export type IntegrationProvider = "hubspot" | "pipedrive" | "slack";

export type ReplyForSync = {
  id: string;
  user_id: string;
  intent: string;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string | null;
  prospect_name: string | null;
  company: string | null;
  campaign_name: string | null;
};

const TIMEOUT_MS = 8000;

async function http(url: string, init: RequestInit): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

function replyText(r: ReplyForSync): string {
  // Drop the quoted history clients append, keep what they wrote.
  const body = (r.body_text ?? r.snippet ?? "").split(/\n(?:On .{5,120}wrote:|-{2,} ?Original Message|From: )/i)[0].trim();
  return body.slice(0, 3000);
}

function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// ---------------- HubSpot (private app token, crm.objects.contacts.write) ----------------
async function pushHubspot(token: string, r: ReplyForSync): Promise<void> {
  const base = "https://api.hubapi.com";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const search = await http(`${base}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: r.from_email }] }],
      properties: ["email"],
      limit: 1,
    }),
  });
  if (search.status >= 300) throw new Error(`HubSpot search ${search.status}: ${search.text.slice(0, 200)}`);
  let contactId: string | undefined = search.json?.results?.[0]?.id;
  if (!contactId) {
    const { first, last } = splitName(r.prospect_name);
    const created = await http(`${base}/crm/v3/objects/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        properties: { email: r.from_email, firstname: first, lastname: last, company: r.company ?? "" },
      }),
    });
    // HubSpot's search index lags a few seconds behind writes, so a contact
    // created moments ago may not be found yet; the create then 409s with
    // "Contact already exists. Existing ID: 123". Use that id.
    const existing = created.status === 409 ? created.text.match(/Existing ID:\s*(\d+)/i)?.[1] : undefined;
    if (existing) contactId = existing;
    else if (created.status >= 300) throw new Error(`HubSpot create contact ${created.status}: ${created.text.slice(0, 200)}`);
    else contactId = created.json?.id;
  }
  const note = await http(`${base}/crm/v3/objects/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      properties: {
        hs_timestamp: r.received_at ?? new Date().toISOString(),
        hs_note_body:
          `<p><b>EmailsVia reply (${r.intent})</b>${r.campaign_name ? ` · campaign “${escapeHtml(r.campaign_name)}”` : ""}</p>` +
          `<p><b>${escapeHtml(r.subject ?? "")}</b></p><p>${escapeHtml(replyText(r)).replace(/\n/g, "<br>")}</p>`,
      },
      // 202 = note → contact (HubSpot-defined association type).
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
    }),
  });
  if (note.status >= 300) throw new Error(`HubSpot note ${note.status}: ${note.text.slice(0, 200)}`);
}

// ---------------- Pipedrive (personal API token) ----------------
async function pushPipedrive(token: string, r: ReplyForSync): Promise<void> {
  const base = "https://api.pipedrive.com/v1";
  const q = `api_token=${encodeURIComponent(token)}`;
  const headers = { "content-type": "application/json" };
  const search = await http(
    `${base}/persons/search?term=${encodeURIComponent(r.from_email)}&fields=email&exact_match=true&limit=1&${q}`,
    { method: "GET" }
  );
  if (search.status >= 300) throw new Error(`Pipedrive search ${search.status}: ${search.text.slice(0, 200)}`);
  let personId: number | undefined = search.json?.data?.items?.[0]?.item?.id;
  if (!personId) {
    const created = await http(`${base}/persons?${q}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: r.prospect_name || r.from_email,
        email: [{ value: r.from_email, primary: true, label: "work" }],
      }),
    });
    if (created.status >= 300) throw new Error(`Pipedrive create person ${created.status}: ${created.text.slice(0, 200)}`);
    personId = created.json?.data?.id;
  }
  const note = await http(`${base}/notes?${q}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      person_id: personId,
      content:
        `<b>EmailsVia reply (${r.intent})</b>${r.campaign_name ? ` · ${escapeHtml(r.campaign_name)}` : ""}<br>` +
        `<b>${escapeHtml(r.subject ?? "")}</b><br>${escapeHtml(replyText(r)).replace(/\n/g, "<br>")}`,
    }),
  });
  if (note.status >= 300) throw new Error(`Pipedrive note ${note.status}: ${note.text.slice(0, 200)}`);
  if (r.intent === "interested") {
    const lead = await http(`${base}/leads?${q}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `${r.prospect_name || r.from_email}${r.company ? ` (${r.company})` : ""} · replied interested`,
        person_id: personId,
      }),
    });
    if (lead.status >= 300) throw new Error(`Pipedrive lead ${lead.status}: ${lead.text.slice(0, 200)}`);
  }
}

// ---------------- Slack (incoming webhook URL) ----------------
async function pushSlack(webhookUrl: string, r: ReplyForSync): Promise<void> {
  const who = r.prospect_name ? `${r.prospect_name} <${r.from_email}>` : r.from_email;
  const text =
    `*${r.intent === "interested" ? "🔥 Interested reply" : `Reply (${r.intent})`}* from ${slackEscape(who)}` +
    `${r.company ? ` at ${slackEscape(r.company)}` : ""}${r.campaign_name ? ` · _${slackEscape(r.campaign_name)}_` : ""}\n` +
    `>${slackEscape(replyText(r).slice(0, 600)).replace(/\n/g, "\n>")}\n` +
    `<${appUrl()}/app/replies|Answer in EmailsVia>`;
  const res = await http(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status >= 300) throw new Error(`Slack ${res.status}: ${res.text.slice(0, 200)}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function pushToProvider(provider: IntegrationProvider, secret: string, r: ReplyForSync): Promise<void> {
  if (provider === "hubspot") return pushHubspot(secret, r);
  if (provider === "pipedrive") return pushPipedrive(secret, r);
  return pushSlack(secret, r);
}

const RETRY_SCHEDULE_MIN = [5, 30, 120, 720];

// Load everything a push needs about a reply (service-role client).
export async function loadReplyForSync(admin: SupabaseClient, replyId: string): Promise<ReplyForSync | null> {
  const { data: reply } = await admin
    .from("replies")
    .select(`
      id, user_id, intent, from_email, subject, snippet, body_text, received_at,
      recipient:recipients(name, company),
      campaign:campaigns(name)
    `)
    .eq("id", replyId)
    .maybeSingle();
  if (!reply?.intent) return null;
  const recipient = (Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient) as { name: string | null; company: string | null } | null;
  const campaign = (Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign) as { name: string } | null;
  return {
    id: reply.id,
    user_id: reply.user_id,
    intent: reply.intent,
    from_email: reply.from_email,
    subject: reply.subject,
    snippet: reply.snippet,
    body_text: reply.body_text,
    received_at: reply.received_at,
    prospect_name: recipient?.name ?? null,
    company: recipient?.company ?? null,
    campaign_name: campaign?.name ?? null,
  };
}

async function planAllowsIntegrations(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { plan } = await getPlanForUser(admin, userId);
  return hasFeature(plan, "webhooks");
}

// One push attempt for a claimed (integration, reply) row; records outcome.
async function runSync(
  admin: SupabaseClient,
  integration: { id: string; provider: string; secret_encrypted: string },
  reply: ReplyForSync,
  attempts: number
): Promise<boolean> {
  try {
    await pushToProvider(integration.provider as IntegrationProvider, decryptSecret(integration.secret_encrypted), reply);
    const now = new Date().toISOString();
    await admin
      .from("integration_syncs")
      .update({ status: "succeeded", attempts: attempts + 1, synced_at: now, last_error: null, next_attempt_at: null })
      .eq("integration_id", integration.id)
      .eq("reply_id", reply.id);
    await admin.from("integrations").update({ last_synced_at: now, last_error: null }).eq("id", integration.id);
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const retryIn = RETRY_SCHEDULE_MIN[attempts];
    await admin
      .from("integration_syncs")
      .update({
        status: retryIn === undefined ? "exhausted" : "failed",
        attempts: attempts + 1,
        last_error: msg,
        next_attempt_at: retryIn === undefined ? null : new Date(Date.now() + retryIn * 60_000).toISOString(),
      })
      .eq("integration_id", integration.id)
      .eq("reply_id", reply.id);
    await admin.from("integrations").update({ last_error: msg }).eq("id", integration.id);
    return false;
  }
}

// Push one reply to every active integration whose push_intents include its
// current label. Tracked per (integration, reply): each integration gets a
// reply at most once, a relabel can still reach an integration that wants
// the new label, and failures are retried by retryFailedSyncs.
export async function syncReplyToIntegrations(admin: SupabaseClient, r: ReplyForSync): Promise<string[]> {
  const { data: integrations } = await admin
    .from("integrations")
    .select("id, provider, secret_encrypted, push_intents")
    .eq("user_id", r.user_id)
    .eq("active", true);
  const matching = (integrations ?? []).filter((i) => (i.push_intents ?? []).includes(r.intent));
  if (matching.length === 0) return [];
  if (!(await planAllowsIntegrations(admin, r.user_id))) return [];

  const done: string[] = [];
  for (const i of matching) {
    // Claim by inserting the tracking row; a duplicate means it was already
    // pushed (or is being pushed) to this integration.
    const { error } = await admin
      .from("integration_syncs")
      .insert({ integration_id: i.id, reply_id: r.id, user_id: r.user_id, status: "pending" });
    if (error) continue;
    if (await runSync(admin, i, r, 0)) done.push(`synced_${i.provider}`);
  }
  return done;
}

// Cron: retry failed pushes whose backoff has elapsed.
export async function retryFailedSyncs(admin: SupabaseClient, opts: { limit?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const { data: due } = await admin
    .from("integration_syncs")
    .select("integration_id, reply_id, user_id, attempts, next_attempt_at, integration:integrations(id, provider, secret_encrypted, active, user_id)")
    .eq("status", "failed")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(opts.limit ?? 50);
  let retried = 0;
  for (const row of due ?? []) {
    if (Date.now() - started > (opts.budgetMs ?? 20_000)) break;
    const integration = (Array.isArray(row.integration) ? row.integration[0] : row.integration) as
      | { id: string; provider: string; secret_encrypted: string; active: boolean; user_id: string }
      | null;
    const reply = await loadReplyForSync(admin, row.reply_id);
    if (!integration || !integration.active || integration.user_id !== row.user_id || !reply || !(await planAllowsIntegrations(admin, row.user_id))) {
      await admin
        .from("integration_syncs")
        .update({ status: "exhausted", next_attempt_at: null })
        .eq("integration_id", row.integration_id)
        .eq("reply_id", row.reply_id);
      continue;
    }
    // Claim against concurrent runs.
    const { data: claimed } = await admin
      .from("integration_syncs")
      .update({ next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString() })
      .eq("integration_id", row.integration_id)
      .eq("reply_id", row.reply_id)
      .eq("status", "failed")
      .eq("next_attempt_at", row.next_attempt_at)
      .select("reply_id");
    if (!claimed?.length) continue;
    await runSync(admin, integration, reply, row.attempts);
    retried++;
  }
  return { retried };
}
