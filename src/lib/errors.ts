// Coarse classifier for send failures. Used to group errors in the admin
// dashboard (and persisted to recipients.error / send_log.error_class so
// queries can `group by error_class`).
//
// Lives outside the cron handlers because both /api/tick and /api/check-replies
// produce errors that share the same shape.
export type ErrorClass =
  | "auth_revoked"      // OAuth refresh token revoked (Google invalid_grant)
  | "auth_failed"       // SMTP / IMAP login refused
  | "sender_auth"       // receiver rejected the SENDER's domain auth (SPF/DKIM/DMARC/PTR)
  | "rate_limit"        // 429 from Gmail API
  | "quota_exceeded"    // Gmail per-user send quota
  | "recipient_invalid" // bad address — Gmail 5xx user-side
  | "network"           // connect / DNS / timeouts
  | "tls"               // SSL/TLS handshake failure
  | "attachment"        // attachment too large / unsupported
  | "unknown";

export function classifyError(err: unknown): ErrorClass {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();

  if (/invalid_grant|invalid_token|token has been expired|revoked/.test(msg)) return "auth_revoked";
  if (/535|invalid login|authentication.*fail|invalid credentials|badcredentials/.test(msg)) return "auth_failed";
  // Gmail 2025+ enforcement (4.7.23 PTR, 4.7.27/5.7.27 SPF, 5.7.26 & 4.7.31
  // DMARC/DKIM, 5.7.30 DKIM) and Outlook.com 5.7.515. Checked before the
  // generic 55x rule: these are about the sender's DNS, not the address.
  if (/\b[45]\.7\.(23|26|27|30|31|515)\b|does not meet the required authentication level|unauthenticated email|dmarc policy|spf.*(fail|check)/.test(msg)) {
    return "sender_auth";
  }
  if (/429|rate ?limit|too many requests|userratelimit/.test(msg)) return "rate_limit";
  if (/quota|dailylimit|sendquota|exceeded.*limit/.test(msg)) return "quota_exceeded";
  if (/55\d|recipient.*invalid|address rejected|no such user|mailbox.*not.*found/.test(msg)) return "recipient_invalid";
  if (/etimedout|enotfound|econnreset|econnrefused|network|socket hang up|aborted/.test(msg)) return "network";
  if (/tls|ssl|certificate|handshake/.test(msg)) return "tls";
  if (/attachment|payload too large|message size|413/.test(msg)) return "attachment";
  return "unknown";
}

// Narrower than "recipient_invalid": true only when the failure is about the
// ADDRESS (5.1.x, unknown user, mailbox missing). 5.7.x policy/auth
// rejections (e.g. Gmail 5.7.27, Outlook 5.7.515) are about the SENDER's
// setup and must never suppress the recipient.
export function isHardBounce(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (/\b5\.7\.\d+/.test(msg)) return false;
  return /\b5\.1\.\d+|user unknown|unknown user|no such user|mailbox (is )?(unavailable|not found|does not exist)|recipient address rejected|address not found|does not exist/.test(msg);
}

// Delivery-status notifications (the "Mail Delivery Subsystem" emails that
// arrive after a send) come in three kinds that need opposite handling:
//   hard         the address doesn't exist → bounce + suppress
//   sender_auth  the receiver rejected OUR domain (SPF/DKIM/DMARC) → the
//                recipient is fine; pause the campaign until DNS is fixed
//   soft         delays ("will retry"), quota, unknown → do nothing
export type DsnKind = "hard" | "sender_auth" | "soft";

export function classifyDsn(subject: string | null, body: string | null): DsnKind {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const lower = text.toLowerCase();
  if (/\(delay\)|delayed|will (retry|keep trying)|temporar(y|ily)|has not yet been delivered/.test(lower)) return "soft";
  if (classifyError(new Error(text)) === "sender_auth") return "sender_auth";
  if (isHardBounce(new Error(text))) return "hard";
  return "soft";
}
