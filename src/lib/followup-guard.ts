import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRecipientInboundSince, type RefreshResult } from "./gmail";
import { fetchRecipientInbound, type IncomingMessage } from "./replies";
import type { SenderCreds } from "./mail";
import { classifyDsn } from "./errors";

// Pre-send guard for follow-ups. /api/check-replies polls every 5 min and is
// opt-in per user, so on its own it can't guarantee we never follow up on
// someone who already answered. Right before each follow-up, tick asks the
// sender's mailbox directly: "has this recipient written back (or bounced)
// since the first email?"

// An out-of-office pauses the sequence this long after the auto-reply date.
export const OOO_PAUSE_DAYS = 7;

export type GuardVerdict =
  | { kind: "clear" }
  | { kind: "replied"; message: IncomingMessage }
  | { kind: "bounced"; message: IncomingMessage }
  | { kind: "sender_auth"; message: IncomingMessage }
  | { kind: "ooo"; message: IncomingMessage; resumeAt: Date };

export async function checkBeforeFollowUp(args: {
  sender: SenderCreds;
  recipientEmail: string;
  since: Date;
  now: Date;
}): Promise<{ verdict: GuardVerdict; tokensRefreshed: RefreshResult | null }> {
  const email = args.recipientEmail.toLowerCase();
  // Emailing your own address (a test campaign): our own sent copies look
  // exactly like mail "from the recipient", so there's nothing to detect.
  const own = [args.sender.email, args.sender.sendAs].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  if (own.includes(email)) return { verdict: { kind: "clear" }, tokensRefreshed: null };
  let messages: IncomingMessage[];
  let tokensRefreshed: RefreshResult | null = null;
  if (args.sender.authMethod === "oauth") {
    const out = await listRecipientInboundSince(
      {
        email: args.sender.email,
        refreshToken: args.sender.refreshToken,
        accessToken: args.sender.accessToken ?? null,
        expiresAt: args.sender.expiresAt ?? null,
      },
      email,
      args.since
    );
    messages = out.messages;
    tokensRefreshed = out.tokensRefreshed;
  } else {
    messages = await fetchRecipientInbound(
      { email: args.sender.email, appPassword: args.sender.appPassword, imap: args.sender.imap },
      email,
      args.since
    );
  }

  let latestOoo: { message: IncomingMessage; resumeAt: Date } | null = null;
  for (const m of messages) {
    const fromRecipient = m.from === email;
    if (!fromRecipient) {
      // Only delivery notices reach here (the search is scoped to the
      // recipient's address or mailer-daemon mentioning it). Delays and
      // unknown notices are ignored; only a real "address doesn't exist"
      // counts as a bounce.
      if (m.is_bounce) {
        const dsn = classifyDsn(m.subject, m.body_text);
        if (dsn === "hard") return { verdict: { kind: "bounced", message: m }, tokensRefreshed };
        if (dsn === "sender_auth") return { verdict: { kind: "sender_auth", message: m }, tokensRefreshed };
      }
      continue;
    }
    // Some auto-responders set Auto-Submitted: auto-generated, which
    // detectBounce also flags — from the recipient's own address that's an
    // auto-reply, not a bounce.
    if (m.is_auto_reply || m.is_bounce) {
      const resumeAt = new Date((m.date ?? args.now).getTime() + OOO_PAUSE_DAYS * 86_400_000);
      if (resumeAt > args.now && (!latestOoo || resumeAt > latestOoo.resumeAt)) {
        latestOoo = { message: m, resumeAt };
      }
      continue;
    }
    return { verdict: { kind: "replied", message: m }, tokensRefreshed };
  }
  if (latestOoo) return { verdict: { kind: "ooo", ...latestOoo }, tokensRefreshed };
  return { verdict: { kind: "clear" }, tokensRefreshed };
}

// Store an inbound message found by the guard in `replies`, keyed the same
// way /api/check-replies upserts, so a later poll doesn't duplicate it (and
// will pick it up for AI triage if the row has no intent yet).
export async function saveGuardReply(
  db: SupabaseClient,
  r: { recipient_id: string; campaign_id: string; user_id: string },
  m: IncomingMessage,
  isAutoReply: boolean,
  now: Date
): Promise<string | null> {
  const { data } = await db
    .from("replies")
    .upsert(
      {
        recipient_id: r.recipient_id,
        campaign_id: r.campaign_id,
        user_id: r.user_id,
        from_email: m.from,
        subject: m.subject,
        snippet: m.snippet,
        body_text: m.body_text,
        body_html: m.body_html,
        received_at: (m.date ?? now).toISOString(),
        is_auto_reply: isAutoReply,
        message_id: m.message_id,
      },
      { onConflict: "recipient_id,received_at" }
    )
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}
