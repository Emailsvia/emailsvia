import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import type { IncomingMessage } from "./replies";

// All Gmail API integration lives here. The two callers are:
//   - sendMail() in lib/mail.ts (when sender.auth_method = 'oauth')
//   - fetchIncomingMessages() in lib/replies.ts (same condition)
// Both pass the encrypted-and-decrypted token bundle stored on senders.

export type GmailOAuthCreds = {
  email: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: Date | null;
  fromName?: string | null;
};

// All Gmail scopes the app ever requests. Bundled here so the connect route
// and the docs/marketing surface stay in sync.
export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function readClientCreds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set");
  }
  return { id, secret };
}

export function oauth2ClientWithRedirect(redirectUri: string): OAuth2Client {
  const { id, secret } = readClientCreds();
  return new google.auth.OAuth2(id, secret, redirectUri);
}

function oauth2Client(): OAuth2Client {
  const { id, secret } = readClientCreds();
  return new google.auth.OAuth2(id, secret);
}

export type RefreshResult = { accessToken: string; expiresAt: Date };

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const oauth = oauth2Client();
  oauth.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth.refreshAccessToken();
  if (!credentials.access_token) throw new Error("gmail_refresh_no_access_token");
  // Google returns expiry_date in ms-since-epoch; if missing we conservatively
  // assume 50min (well under the typical 1h validity).
  const expiresAt = credentials.expiry_date
    ? new Date(credentials.expiry_date)
    : new Date(Date.now() + 50 * 60 * 1000);
  return { accessToken: credentials.access_token, expiresAt };
}

// Returns a live access token, refreshing if missing or near-expiry. The
// `refreshed` flag tells the caller whether to persist the new (accessToken,
// expiresAt) pair back to the senders row.
export async function ensureFreshAccessToken(
  creds: Pick<GmailOAuthCreds, "refreshToken" | "accessToken" | "expiresAt">
): Promise<{ accessToken: string; expiresAt: Date; refreshed: boolean }> {
  const stillValid =
    !!creds.accessToken &&
    !!creds.expiresAt &&
    creds.expiresAt.getTime() - Date.now() > 60_000; // 60s safety margin
  if (stillValid) {
    return {
      accessToken: creds.accessToken!,
      expiresAt: creds.expiresAt!,
      refreshed: false,
    };
  }
  const { accessToken, expiresAt } = await refreshAccessToken(creds.refreshToken);
  return { accessToken, expiresAt, refreshed: true };
}

function gmailClient(accessToken: string, refreshToken: string) {
  const oauth = oauth2Client();
  oauth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth });
}

// Build the RFC 2822 message via nodemailer's MailComposer so multipart
// + attachments + custom headers come out byte-identical to the SMTP path.
async function buildRawMessage(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender: GmailOAuthCreds;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
}): Promise<string> {
  const fromHeader = args.sender.fromName
    ? `"${args.sender.fromName}" <${args.sender.email}>`
    : args.sender.email;
  const composer = new MailComposer({
    from: fromHeader,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
    replyTo: args.sender.email,
    attachments: args.attachments,
    headers: args.headers,
  });
  const raw = await new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
  // Gmail API expects URL-safe base64 with no padding.
  return raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type SendResult = {
  messageId: string;     // RFC 5322 Message-ID header (used for threading)
  gmailId: string;       // Gmail-internal message id
  threadId: string;
  tokensRefreshed: RefreshResult | null;
};

export async function sendViaGmailApi(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender: GmailOAuthCreds;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const fresh = await ensureFreshAccessToken({
    refreshToken: args.sender.refreshToken,
    accessToken: args.sender.accessToken,
    expiresAt: args.sender.expiresAt,
  });
  const gmail = gmailClient(fresh.accessToken, args.sender.refreshToken);

  const raw = await buildRawMessage(args);
  const sendRes = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  const gmailId = sendRes.data.id ?? "";
  const threadId = sendRes.data.threadId ?? "";

  // Pull the RFC Message-ID header so follow-ups can thread to it. Gmail
  // doesn't return it from the send call itself.
  let messageId = "";
  if (gmailId) {
    try {
      const meta = await gmail.users.messages.get({
        userId: "me",
        id: gmailId,
        format: "metadata",
        metadataHeaders: ["Message-ID"],
      });
      const hdr = (meta.data.payload?.headers ?? []).find(
        (h) => (h.name ?? "").toLowerCase() === "message-id"
      );
      messageId = hdr?.value ?? "";
    } catch {
      // Non-fatal: send succeeded, threading just won't have a Message-ID.
    }
  }

  return {
    messageId,
    gmailId,
    threadId,
    tokensRefreshed: fresh.refreshed
      ? { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt }
      : null,
  };
}

// Verify that a freshly issued OAuth token actually grants Gmail access — we
// call this from the connect callback so misconfigured Cloud projects fail
// loudly at link-time, not 24 hours later when the campaign tries to send.
export async function verifyGmailAccess(creds: Pick<GmailOAuthCreds, "refreshToken" | "accessToken" | "expiresAt">): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  try {
    const fresh = await ensureFreshAccessToken(creds);
    const gmail = gmailClient(fresh.accessToken, creds.refreshToken);
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress ?? "";
    if (!email) return { ok: false, error: "no_email_in_profile" };
    return { ok: true, email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Mirror of replies.ts > fetchIncomingMessages but using the Gmail API.
// Reuses the IncomingMessage shape so the reply-correlation code in
// /api/check-replies doesn't have to branch.
export async function listInboxSince(
  sender: GmailOAuthCreds,
  since: Date,
  opts: { maxMessages?: number } = {}
): Promise<{ messages: IncomingMessage[]; tokensRefreshed: RefreshResult | null }> {
  const max = opts.maxMessages ?? 500;
  const fresh = await ensureFreshAccessToken({
    refreshToken: sender.refreshToken,
    accessToken: sender.accessToken,
    expiresAt: sender.expiresAt,
  });
  const gmail = gmailClient(fresh.accessToken, sender.refreshToken);

  // Gmail's `after:` query takes a Unix timestamp in seconds.
  const afterSec = Math.floor(since.getTime() / 1000);
  const q = `in:inbox after:${afterSec}`;

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(500, max - ids.length),
      pageToken,
    });
    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id);
      if (ids.length >= max) break;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < max);

  if (ids.length === 0) {
    return { messages: [], tokensRefreshed: fresh.refreshed ? { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt } : null };
  }

  const out: IncomingMessage[] = [];
  // Modest concurrency — Gmail will rate-limit us at ~250 quota-units/sec
  // per user. Each .get with format=raw is 5 units. 8 in flight is comfy.
  const CONC = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      const id = ids[i];
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "raw",
        });
        const rawB64 = msg.data.raw;
        if (!rawB64) continue;
        // Gmail returns URL-safe base64 with no padding — convert before parsing.
        const buf = Buffer.from(rawB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        const parsed = await simpleParser(buf);
        const fromAddr =
          parsed.from?.value?.[0]?.address?.toLowerCase() ?? null;
        if (!fromAddr) continue;

        const subject = parsed.subject ?? null;
        const bodyText = parsed.text ?? null;
        const bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
        const snippet = bodyText
          ? bodyText.replace(/\s+/g, " ").trim().slice(0, 200)
          : null;

        const inReplyTo = normalizeMsgId(
          typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null
        );
        let references: string[] = [];
        if (Array.isArray(parsed.references)) {
          references = parsed.references
            .map((r) => normalizeMsgId(r))
            .filter((x): x is string => !!x);
        } else if (typeof parsed.references === "string") {
          references = parsed.references
            .split(/\s+/)
            .map((r) => normalizeMsgId(r))
            .filter((x): x is string => !!x);
        }

        out.push({
          from: fromAddr,
          subject,
          snippet,
          body_text: bodyText,
          body_html: bodyHtml,
          date: parsed.date ?? null,
          in_reply_to: inReplyTo,
          references,
          is_auto_reply: detectAutoReply(parsed.headers, subject, fromAddr),
          is_bounce: detectBounce(parsed.headers, subject, fromAddr),
        });
      } catch {
        // Skip messages we can't parse — Gmail occasionally returns 404 for
        // mid-flight deletions. We still want to make progress on the rest.
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));

  return {
    messages: out,
    tokensRefreshed: fresh.refreshed
      ? { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt }
      : null,
  };
}

// ---- Helpers below are duplicated from replies.ts on purpose. They're tiny
// and tightly tied to mailparser, so re-exporting from replies.ts would
// pull imapflow into this module's import graph.

function normalizeMsgId(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/^[<\s]+|[>\s]+$/g, "")}>`;
}

function headerValue(headers: Map<string, unknown> | undefined, name: string): string | null {
  if (!headers) return null;
  const v = headers.get(name.toLowerCase());
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(" ");
  return String(v);
}

function detectAutoReply(
  headers: Map<string, unknown> | undefined,
  subject: string | null,
  fromAddr: string
): boolean {
  const autoSubmitted = headerValue(headers, "auto-submitted")?.toLowerCase() ?? "";
  if (autoSubmitted && autoSubmitted !== "no") return true;
  const precedence = headerValue(headers, "precedence")?.toLowerCase() ?? "";
  if (/(auto[_-]?reply|bulk|list|junk)/.test(precedence)) return true;
  if (headerValue(headers, "x-autoreply")) return true;
  if (headerValue(headers, "x-autorespond")) return true;
  if (headerValue(headers, "x-auto-response-suppress")) return true;
  if (headerValue(headers, "list-id")) return true;
  const subj = (subject ?? "").toLowerCase().trim();
  if (
    subj.startsWith("auto:") ||
    subj.startsWith("automatic reply") ||
    subj.startsWith("auto-reply") ||
    subj.startsWith("out of office") ||
    subj.startsWith("out-of-office") ||
    subj.startsWith("vacation:") ||
    subj.startsWith("away from office")
  ) return true;
  if (/^(no[-_]?reply|donotreply|do[-_]?not[-_]?reply|notifications?|system|robot)@/.test(fromAddr)) {
    return true;
  }
  return false;
}

function detectBounce(
  headers: Map<string, unknown> | undefined,
  subject: string | null,
  fromAddr: string
): boolean {
  if (/^(mailer-daemon|postmaster|mail-daemon)@/i.test(fromAddr)) return true;
  const autoSubmitted = headerValue(headers, "auto-submitted")?.toLowerCase() ?? "";
  if (autoSubmitted.includes("auto-generated")) return true;
  if (headerValue(headers, "x-failed-recipients")) return true;
  const contentType = headerValue(headers, "content-type")?.toLowerCase() ?? "";
  if (contentType.includes("report-type=delivery-status")) return true;
  const subj = (subject ?? "").toLowerCase();
  if (
    subj.includes("delivery status notification") ||
    subj.includes("undeliverable") ||
    subj.includes("undelivered mail") ||
    subj.includes("mail delivery failed") ||
    subj.includes("failure notice") ||
    subj.includes("returned mail")
  ) return true;
  return false;
}
