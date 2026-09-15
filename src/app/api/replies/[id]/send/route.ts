import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { supabaseUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/auth-server";
import { sendMail } from "@/lib/mail";
import { toHtml, toPlain } from "@/lib/template";
import { loadSenderCreds, persistRefreshedToken } from "@/lib/sender-creds";
import { classifyError } from "@/lib/errors";
import { markSenderRevoked } from "@/lib/sender-revoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Schema = z.object({
  body: z.string().trim().min(1).max(20_000),
});

// Answer a reply from inside EmailsVia. Goes out from the mailbox that ran
// the sequence, threaded under the prospect's message (In-Reply-To their
// Message-ID, References the whole chain, same Gmail thread), with no
// tracking pixel or unsubscribe footer: this is a 1:1 conversation now.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("suspended_at")
    .eq("user_id", u.id)
    .maybeSingle();
  if (sub?.suspended_at) return NextResponse.json({ error: "account_suspended" }, { status: 403 });

  const db = await supabaseUser();
  const { data: reply } = await db
    .from("replies")
    .select(`
      id, from_email, subject, message_id, campaign_id,
      recipient:recipients(id, email, message_id, gmail_thread_id, sender_id),
      campaign:campaigns(id, subject, sender_id)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!reply) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const recipient = (Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient) as {
    id: string; email: string; message_id: string | null; gmail_thread_id: string | null; sender_id: string | null;
  } | null;
  const campaign = (Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign) as {
    id: string; subject: string; sender_id: string | null;
  } | null;

  const senderId = recipient?.sender_id ?? campaign?.sender_id ?? null;
  if (!senderId) {
    return NextResponse.json({ error: "This campaign has no sender to reply from." }, { status: 400 });
  }
  // Service-role load (token columns), then an explicit ownership check.
  const sender = await loadSenderCreds(admin, senderId);
  if (!sender || sender.userId !== u.id) {
    return NextResponse.json({ error: "The sender for this campaign no longer exists." }, { status: 400 });
  }
  if (sender.oauthRevoked || !sender.creds) {
    return NextResponse.json({ error: `${sender.email} is disconnected. Reconnect it on the Senders page.` }, { status: 400 });
  }

  const to = recipient?.email ?? reply.from_email;
  const baseSubject = (reply.subject || campaign?.subject || "").replace(/^(re|aw|sv):\s*/i, "");
  const subject = `Re: ${baseSubject}`.trim();
  const chain = Array.from(new Set([recipient?.message_id, reply.message_id].filter((x): x is string => !!x)));
  const headers: Record<string, string> = {};
  if (chain.length > 0) {
    headers["In-Reply-To"] = chain[chain.length - 1];
    headers["References"] = chain.join(" ");
  }

  try {
    const result = await sendMail({
      to,
      subject,
      text: toPlain(parsed.data.body),
      html: toHtml(parsed.data.body),
      sender: sender.creds,
      headers,
      threadId: recipient?.sender_id === sender.id ? recipient?.gmail_thread_id ?? null : null,
    });
    await persistRefreshedToken(admin, sender.id, result.tokensRefreshed);

    const now = new Date().toISOString();
    const { data: saved } = await db
      .from("reply_messages")
      .insert({
        user_id: u.id,
        reply_id: reply.id,
        recipient_id: recipient?.id ?? null,
        campaign_id: reply.campaign_id,
        sender_id: sender.id,
        subject,
        body: parsed.data.body,
        message_id: result.messageId || null,
        sent_at: now,
      })
      .select("id, subject, body, sent_at")
      .single();
    await db.from("replies").update({ handled_at: now, read_at: now }).eq("id", reply.id);
    return NextResponse.json({ ok: true, message: saved });
  } catch (e) {
    const errorClass = classifyError(e);
    if (errorClass === "auth_revoked") {
      await markSenderRevoked(admin, { sender_id: sender.id, sender_email: sender.email, user_id: u.id });
    }
    Sentry.captureException(e, { tags: { route: "reply_send", error_class: errorClass } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), error_class: errorClass },
      { status: 502 }
    );
  }
}
