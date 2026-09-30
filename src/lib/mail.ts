import nodemailer, { type Transporter } from "nodemailer";
import { sendViaGmailApi, type GmailOAuthCreds, type RefreshResult } from "./gmail";
import { verifyImap } from "./replies";

// SMTP or IMAP server endpoint. `secure` = implicit TLS (465 / 993);
// false = plain connect upgraded via STARTTLS (587).
export type HostConfig = { host: string; port: number; secure: boolean };

export const GMAIL_SMTP: HostConfig = { host: "smtp.gmail.com", port: 465, secure: true };
export const GMAIL_IMAP: HostConfig = { host: "imap.gmail.com", port: 993, secure: true };

// Sender bundle handed to sendMail/verifyCredentials. Discriminated union
// so callers can't accidentally mix OAuth fields with app-password fields.
// `smtp`/`imap` are set only for provider='smtp' (custom-domain) senders;
// absent means a Gmail app-password sender.
export type AppPasswordSender = {
  authMethod: "app_password";
  email: string;
  appPassword: string;
  fromName?: string | null;
  sendAs?: string | null;
  smtp?: HostConfig;
  imap?: HostConfig;
};

// Columns added in migration 0017. Select these alongside the usual sender
// columns and spread `serversFromRow(row)` into an AppPasswordSender.
// Also carries `send_as_email` (migration 0018) so every loader that selects
// these picks up the alias without a second column list.
export const SENDER_SERVER_COLUMNS =
  "provider, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, send_as_email";

export type SenderServerRow = {
  send_as_email?: string | null;
  provider?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_secure?: boolean | null;
};

export function serversFromRow(row: SenderServerRow): { smtp?: HostConfig; imap?: HostConfig } {
  if (row.provider !== "smtp") return {};
  // DB constraint senders_smtp_config_chk guarantees these are non-null.
  return {
    smtp: { host: row.smtp_host!, port: row.smtp_port!, secure: row.smtp_secure! },
    imap: { host: row.imap_host!, port: row.imap_port!, secure: row.imap_secure! },
  };
}

export type OAuthSender = {
  authMethod: "oauth";
  email: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: Date | null;
  fromName?: string | null;
  sendAs?: string | null;
};

export type SenderCreds = AppPasswordSender | OAuthSender;

// (Removed: legacy GMAIL_ADDRESS/GMAIL_APP_PASSWORD env-fallback sender.
//  Single-tenant artifact — would have routed every campaign without a
//  sender_id from the operator's personal Gmail. Multi-tenant now: every
//  campaign MUST have a sender_id, and callers MUST resolve a SenderCreds
//  object before calling sendMail().)

const cache = new Map<string, Transporter>();

function makeTransporter(creds: AppPasswordSender) {
  const smtp = creds.smtp ?? GMAIL_SMTP;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // On a non-TLS port, refuse to send the password unless STARTTLS succeeds.
    requireTLS: !smtp.secure,
    // Google shows app passwords as "xxxx xxxx xxxx xxxx" — strip those spaces.
    // Custom mailbox passwords are used verbatim (a space may be real).
    auth: { user: creds.email, pass: creds.smtp ? creds.appPassword : creds.appPassword.replace(/\s+/g, "") },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

// Keyed by server + mailbox so a sender whose host config changes never
// reuses a pooled connection to the old server.
function cacheKey(creds: AppPasswordSender) {
  const smtp = creds.smtp ?? GMAIL_SMTP;
  return `${smtp.host}:${smtp.port}:${creds.email}`;
}

function transporter(creds: AppPasswordSender) {
  const key = cacheKey(creds);
  const hit = cache.get(key);
  if (hit) return hit;
  const t = makeTransporter(creds);
  cache.set(key, t);
  return t;
}

function invalidate(creds: AppPasswordSender) {
  const key = cacheKey(creds);
  const hit = cache.get(key);
  if (hit) {
    try { hit.close(); } catch {}
    cache.delete(key);
  }
}

export type SendResult = {
  messageId: string;
  // Gmail API thread id (OAuth senders only).
  threadId?: string | null;
  // Populated only for OAuth senders when we had to refresh the access
  // token mid-send. Caller must persist these to the senders row so the
  // next tick doesn't re-refresh.
  tokensRefreshed?: RefreshResult | null;
};

export async function sendMail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender: SenderCreds;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
  threadId?: string | null;
}): Promise<SendResult> {
  const creds = args.sender;

  if (creds.authMethod === "oauth") {
    const oauthCreds: GmailOAuthCreds = {
      email: creds.email,
      refreshToken: creds.refreshToken,
      accessToken: creds.accessToken ?? null,
      expiresAt: creds.expiresAt ?? null,
      fromName: creds.fromName ?? null,
      sendAs: creds.sendAs ?? null,
    };
    const res = await sendViaGmailApi({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      sender: oauthCreds,
      attachments: args.attachments,
      headers: args.headers,
      threadId: args.threadId,
    });
    return {
      messageId: res.messageId,
      threadId: res.threadId || null,
      tokensRefreshed: res.tokensRefreshed,
    };
  }

  // Authenticate as `email`; show the alias (if any) in From / Reply-To.
  const fromAddr = creds.sendAs || creds.email;
  const from = creds.fromName ? `"${creds.fromName}" <${fromAddr}>` : fromAddr;
  try {
    const info = await transporter(creds).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      replyTo: fromAddr,
      attachments: args.attachments,
      headers: args.headers,
    });
    return { messageId: info.messageId };
  } catch (e) {
    // SMTP session might be stale/broken — drop the cached transporter so the
    // next send rebuilds a fresh connection instead of retrying a dead socket.
    invalidate(creds);
    throw e;
  }
}

export async function verifyCredentials(
  creds: AppPasswordSender | Omit<AppPasswordSender, "authMethod">
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Accept either a typed AppPasswordSender or the raw shape used by the
  // senders POST handler before it knows the auth_method.
  const ap: AppPasswordSender = { ...creds, authMethod: "app_password" };
  try {
    await transporter(ap).verify();
  } catch (e) {
    invalidate(ap);
    return { ok: false, error: `SMTP: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Custom-domain senders: also prove the IMAP side works, otherwise replies
  // would silently never arrive. (Gmail app passwords cover both.)
  if (ap.imap) {
    try {
      await verifyImap({ email: ap.email, appPassword: ap.appPassword, imap: ap.imap });
    } catch (e) {
      return { ok: false, error: `IMAP: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { ok: true };
}
