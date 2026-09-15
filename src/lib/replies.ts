import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { HostConfig } from "./mail";

export type IncomingMessage = {
  from: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  date: Date | null;
  message_id: string | null;       // this message's own normalized <message-id>
  in_reply_to: string | null;      // normalized <message-id>
  references: string[];             // normalized <message-id>s
  is_auto_reply: boolean;           // vacation responders, out-of-office
  is_bounce: boolean;               // delivery failure notices
};

// Normalize a Message-ID header to `<...>` form (mailparser sometimes strips brackets).
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
  if (autoSubmitted && autoSubmitted !== "no") return true; // RFC 3834

  const precedence = headerValue(headers, "precedence")?.toLowerCase() ?? "";
  if (/(auto[_-]?reply|bulk|list|junk)/.test(precedence)) return true;

  if (headerValue(headers, "x-autoreply")) return true;
  if (headerValue(headers, "x-autorespond")) return true;
  if (headerValue(headers, "x-auto-response-suppress")) return true;

  // Mailing lists — ignore them too (they're rarely genuine 1:1 replies)
  if (headerValue(headers, "list-id") || headerValue(headers, "list-unsubscribe")) {
    // Only treat as auto if BOTH List-* are present — some replies from
    // corporate systems carry List-Unsubscribe alone and are still genuine.
    if (headerValue(headers, "list-id")) return true;
  }

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

  // Noreply-style senders very rarely send genuine 1:1 replies
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

type ImapCreds = { email: string; appPassword: string; imap?: HostConfig };

function makeImapClient(creds: ImapCreds) {
  // Absent `imap` = Gmail app-password sender. Literal kept here (not
  // imported from mail.ts) to avoid a runtime import cycle.
  const imap = creds.imap ?? { host: "imap.gmail.com", port: 993, secure: true };
  return new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    // Strip spaces only from Gmail app passwords; custom passwords verbatim.
    auth: { user: creds.email, pass: creds.imap ? creds.appPassword : creds.appPassword.replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 25_000,
  });
}

// Connect + login + logout. Throws on bad host / bad password.
export async function verifyImap(creds: ImapCreds): Promise<void> {
  const client = makeImapClient(creds);
  await client.connect();
  try { await client.logout(); } catch {}
}

// Poll an inbox over IMAP (Gmail or a custom host) for inbound messages.
// Capped at `maxMessages` newest within the `since` window so the cron
// function doesn't time out on active inboxes (Vercel 60s budget).
export async function fetchIncomingMessages(
  creds: ImapCreds,
  since: Date,
  opts: { maxMessages?: number } = {}
): Promise<IncomingMessage[]> {
  const max = opts.maxMessages ?? 500;
  const client = makeImapClient(creds);

  const out: IncomingMessage[] = [];
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({ since });
    if (!uids || uids.length === 0) return [];
    const slice = (uids as number[]).slice(-max);
    for await (const msg of client.fetch(slice, { envelope: true, source: true })) {
      const parsed = await toIncoming(msg);
      if (parsed) out.push(parsed);
    }
  } finally {
    try { await client.logout(); } catch {}
  }
  return out;
}

type FetchedImapMessage = {
  envelope?: { from?: { address?: string }[]; subject?: string; date?: Date };
  source?: Buffer;
};

async function toIncoming(msg: FetchedImapMessage): Promise<IncomingMessage | null> {
  const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
  if (!addr) return null;
  let bodyText: string | null = null;
  let bodyHtml: string | null = null;
  let snippet: string | null = null;
  let inReplyTo: string | null = null;
  let messageId: string | null = null;
  let references: string[] = [];
  let isAutoReply = false;
  let isBounce = false;
  const subject = msg.envelope?.subject ?? null;
  if (msg.source) {
    try {
      const parsed = await simpleParser(msg.source);
      bodyText = parsed.text ?? null;
      bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
      if (bodyText) {
        snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
      }
      // mailparser exposes these as typed fields already
      inReplyTo = normalizeMsgId(typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null);
      messageId = normalizeMsgId(typeof parsed.messageId === "string" ? parsed.messageId : null);
      if (Array.isArray(parsed.references)) {
        references = parsed.references.map((r) => normalizeMsgId(r)).filter((x): x is string => !!x);
      } else if (typeof parsed.references === "string") {
        references = parsed.references
          .split(/\s+/)
          .map((r) => normalizeMsgId(r))
          .filter((x): x is string => !!x);
      }
      isAutoReply = detectAutoReply(parsed.headers, subject, addr);
      isBounce = detectBounce(parsed.headers, subject, addr);
    } catch {
      // ignore parse errors, keep envelope info only
    }
  }
  return {
    from: addr,
    subject,
    snippet,
    body_text: bodyText,
    body_html: bodyHtml,
    date: msg.envelope?.date ?? null,
    message_id: messageId,
    in_reply_to: inReplyTo,
    references,
    is_auto_reply: isAutoReply,
    is_bounce: isBounce,
  };
}

// Pre-send guard for follow-ups (IMAP senders): mail from one recipient, plus
// bounce notices mentioning them, received since `since`. IMAP SINCE is
// date-granular, so results are re-filtered on the envelope date. Throws on
// connection/login failure so the caller can fail closed.
export async function fetchRecipientInbound(
  creds: ImapCreds,
  recipientEmail: string,
  since: Date
): Promise<IncomingMessage[]> {
  const client = makeImapClient(creds);
  const out: IncomingMessage[] = [];
  await client.connect();
  try {
    // A reply the user already archived, filtered or that landed in spam is
    // still a reply. Search the "all mail" folder when the server has one
    // (Gmail: [Gmail]/All Mail, whatever it's called in the account's
    // language), otherwise INBOX; plus the junk folder.
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === "\\All")?.path;
    const junk = boxes.find((b) => b.specialUse === "\\Junk")?.path;
    const paths = Array.from(new Set([all ?? "INBOX", ...(junk ? [junk] : [])]));
    for (const path of paths) {
      const lock = await client.getMailboxLock(path);
      try {
        const fromHits = (await client.search({ since, from: recipientEmail }, { uid: true })) || [];
        const bounceHits =
          (await client.search(
            { since, or: [{ from: "mailer-daemon" }, { from: "postmaster" }], body: recipientEmail },
            { uid: true }
          )) || [];
        const uids = Array.from(new Set([...(fromHits as number[]), ...(bounceHits as number[])]))
          .sort((a, b) => a - b)
          .slice(-10);
        if (uids.length === 0) continue;
        for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
          const parsed = await toIncoming(msg);
          if (!parsed) continue;
          if (parsed.date && parsed.date.getTime() < since.getTime()) continue;
          out.push(parsed);
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try { await client.logout(); } catch {}
  }
  return out;
}

// Backwards-compat wrapper (not used anymore but kept so callers don't break)
export async function fetchIncomingSenders(
  creds: { email: string; appPassword: string },
  since: Date
): Promise<string[]> {
  const msgs = await fetchIncomingMessages(creds, since);
  return Array.from(new Set(msgs.map((m) => m.from)));
}
