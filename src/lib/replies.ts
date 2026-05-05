import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export type IncomingMessage = {
  from: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  date: Date | null;
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

// Poll Gmail over IMAP for inbound messages. Capped at `maxMessages` newest
// within the `since` window so the cron function doesn't time out on active
// inboxes (Vercel 60s budget).
export async function fetchIncomingMessages(
  creds: { email: string; appPassword: string },
  since: Date,
  opts: { maxMessages?: number } = {}
): Promise<IncomingMessage[]> {
  const max = opts.maxMessages ?? 500;
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    logger: false,
    socketTimeout: 25_000,
  });

  const out: IncomingMessage[] = [];
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({ since });
    if (!uids || uids.length === 0) return [];
    const slice = (uids as number[]).slice(-max);
    for await (const msg of client.fetch(slice, { envelope: true, source: true })) {
      const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
      if (!addr) continue;
      let bodyText: string | null = null;
      let bodyHtml: string | null = null;
      let snippet: string | null = null;
      let inReplyTo: string | null = null;
      let references: string[] = [];
      let isAutoReply = false;
      let isBounce = false;
      const subject = msg.envelope?.subject ?? null;
      if (msg.source) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          bodyText = parsed.text ?? null;
          bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
          if (bodyText) {
            snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);
          }
          // mailparser exposes these as typed fields already
          inReplyTo = normalizeMsgId(typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null);
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
      out.push({
        from: addr,
        subject,
        snippet,
        body_text: bodyText,
        body_html: bodyHtml,
        date: msg.envelope?.date ?? null,
        in_reply_to: inReplyTo,
        references,
        is_auto_reply: isAutoReply,
        is_bounce: isBounce,
      });
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
