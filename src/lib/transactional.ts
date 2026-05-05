import "server-only";
import { ServerClient, Models } from "postmark";

// Transactional mail. Distinct from /api/tick (which sends user campaigns
// via the user's own Gmail). This lane sends FROM us TO our users —
// "your sender disconnected", dunning notifications, OAuth-revoked alerts.
//
// Sending these via Postmark instead of our own Gmail keeps system mail
// off the user-Gmail reputation, so a bad sending day on the campaign
// rail can't tank receipts and password resets.

let cached: ServerClient | null = null;

function client(): ServerClient | null {
  if (cached) return cached;
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return null; // not configured — caller decides what to do
  cached = new ServerClient(token);
  return cached;
}

function fromAddress(): string {
  const email = process.env.POSTMARK_FROM_EMAIL ?? "hello@emailsvia.com";
  const name = process.env.POSTMARK_FROM_NAME ?? "EmailsVia";
  return name ? `"${name}" <${email}>` : email;
}

export type TransactionalSendArgs = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  // `tag` shows up in Postmark's UI as a filter — useful to slice "how many
  // sender-revoked emails went out this week" without eyeballing message
  // bodies. Use lowercase-with-dashes.
  tag?: string;
  // Optional metadata for filtering / debugging in the Postmark dashboard.
  metadata?: Record<string, string>;
};

export async function sendTransactional(
  args: TransactionalSendArgs
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const c = client();
  if (!c) return { ok: false, reason: "postmark_not_configured" };

  try {
    const res = await c.sendEmail({
      From: fromAddress(),
      To: args.to,
      Subject: args.subject,
      TextBody: args.textBody,
      HtmlBody: args.htmlBody,
      Tag: args.tag,
      Metadata: args.metadata,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
      // Tracking off — we're sending to our own users, not prospects, and
      // Postmark's pixel adds nothing useful for ops mail.
      TrackOpens: false,
      TrackLinks: Models.LinkTrackingOptions.None,
    });
    return { ok: true, messageId: res.MessageID };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// Notification: a connected Gmail OAuth sender stopped working. The user's
// campaigns won't run until they reconnect. Sent at-most-once per sender per
// "revoked" event by the caller (check the previous oauth_status before
// firing, so a tick that re-detects the same revoked state doesn't spam).
export async function sendSenderRevokedNotice(args: {
  to: string;
  senderEmail: string;
  appUrl: string;
}) {
  const subject = `Action needed: ${args.senderEmail} disconnected from EmailsVia`;
  const portalUrl = `${args.appUrl.replace(/\/$/, "")}/app/senders`;
  const text = [
    `Hi,`,
    ``,
    `Your connected Gmail account ${args.senderEmail} stopped working — Google has revoked the OAuth permission EmailsVia was using to send mail on its behalf.`,
    ``,
    `Campaigns assigned to this sender are paused until you reconnect.`,
    ``,
    `Reconnect here: ${portalUrl}`,
    ``,
    `If you intentionally revoked access (security audit, password change, etc.), feel free to ignore this email or delete the sender row.`,
    ``,
    `— EmailsVia`,
  ].join("\n");
  const html = `
    <p>Hi,</p>
    <p>Your connected Gmail account <strong>${args.senderEmail}</strong> stopped working — Google has revoked the OAuth permission EmailsVia was using to send mail on its behalf.</p>
    <p>Campaigns assigned to this sender are paused until you reconnect.</p>
    <p><a href="${portalUrl}">Reconnect this sender</a></p>
    <p style="color:#888;font-size:12px">If you intentionally revoked access (security audit, password change, etc.), feel free to ignore this email or delete the sender row.</p>
    <p>— EmailsVia</p>
  `;
  return sendTransactional({
    to: args.to,
    subject,
    textBody: text,
    htmlBody: html,
    tag: "sender-revoked",
    metadata: { sender_email: args.senderEmail },
  });
}

// Notification: Stripe couldn't charge the user's card. Sent on the first
// invoice.payment_failed webhook only (so we don't spam during the retry
// window). Body nudges them to the customer portal.
export async function sendPaymentFailedNotice(args: {
  to: string;
  appUrl: string;
}) {
  const subject = "Payment failed on your EmailsVia subscription";
  const portalUrl = `${args.appUrl.replace(/\/$/, "")}/app/billing`;
  const text = [
    `Hi,`,
    ``,
    `Stripe wasn't able to charge your card for this billing cycle. We'll keep retrying for the next few days, but you'll lose paid features if all retries fail.`,
    ``,
    `Update your payment method: ${portalUrl}`,
    ``,
    `— EmailsVia`,
  ].join("\n");
  const html = `
    <p>Hi,</p>
    <p>Stripe wasn't able to charge your card for this billing cycle. We'll keep retrying for the next few days, but you'll lose paid features if all retries fail.</p>
    <p><a href="${portalUrl}">Update your payment method</a></p>
    <p>— EmailsVia</p>
  `;
  return sendTransactional({
    to: args.to,
    subject,
    textBody: text,
    htmlBody: html,
    tag: "payment-failed",
  });
}
