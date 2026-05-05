// Coarse classifier for send failures. Used to group errors in the admin
// dashboard (and persisted to recipients.error / send_log.error_class so
// queries can `group by error_class`).
//
// Lives outside the cron handlers because both /api/tick and /api/check-replies
// produce errors that share the same shape.
export type ErrorClass =
  | "auth_revoked"      // OAuth refresh token revoked (Google invalid_grant)
  | "auth_failed"       // SMTP / IMAP login refused
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
  if (/429|rate ?limit|too many requests|userratelimit/.test(msg)) return "rate_limit";
  if (/quota|dailylimit|sendquota|exceeded.*limit/.test(msg)) return "quota_exceeded";
  if (/55\d|recipient.*invalid|address rejected|no such user|mailbox.*not.*found/.test(msg)) return "recipient_invalid";
  if (/etimedout|enotfound|econnreset|econnrefused|network|socket hang up|aborted/.test(msg)) return "network";
  if (/tls|ssl|certificate|handshake/.test(msg)) return "tls";
  if (/attachment|payload too large|message size|413/.test(msg)) return "attachment";
  return "unknown";
}
