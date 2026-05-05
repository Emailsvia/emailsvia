import nodemailer from "nodemailer";
import { sendViaGmailApi, type GmailOAuthCreds, type RefreshResult } from "./gmail";

// Sender bundle handed to sendMail/verifyCredentials. Discriminated union
// so callers can't accidentally mix OAuth fields with app-password fields.
export type AppPasswordSender = {
  authMethod: "app_password";
  email: string;
  appPassword: string;
  fromName?: string | null;
};

export type OAuthSender = {
  authMethod: "oauth";
  email: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: Date | null;
  fromName?: string | null;
};

export type SenderCreds = AppPasswordSender | OAuthSender;

function fallbackEnv(): AppPasswordSender {
  const email = process.env.GMAIL_ADDRESS;
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!email || !appPassword) {
    throw new Error("No sender configured and GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set");
  }
  return {
    authMethod: "app_password",
    email,
    appPassword,
    fromName: process.env.GMAIL_FROM_NAME,
  };
}

const cache = new Map<string, nodemailer.Transporter>();

function makeTransporter(creds: AppPasswordSender) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

function transporter(creds: AppPasswordSender) {
  const hit = cache.get(creds.email);
  if (hit) return hit;
  const t = makeTransporter(creds);
  cache.set(creds.email, t);
  return t;
}

function invalidate(email: string) {
  const hit = cache.get(email);
  if (hit) {
    try { hit.close(); } catch {}
    cache.delete(email);
  }
}

export type SendResult = {
  messageId: string;
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
  sender?: SenderCreds | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const creds = args.sender ?? fallbackEnv();

  if (creds.authMethod === "oauth") {
    const oauthCreds: GmailOAuthCreds = {
      email: creds.email,
      refreshToken: creds.refreshToken,
      accessToken: creds.accessToken ?? null,
      expiresAt: creds.expiresAt ?? null,
      fromName: creds.fromName ?? null,
    };
    const res = await sendViaGmailApi({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      sender: oauthCreds,
      attachments: args.attachments,
      headers: args.headers,
    });
    return {
      messageId: res.messageId,
      tokensRefreshed: res.tokensRefreshed,
    };
  }

  const from = creds.fromName ? `"${creds.fromName}" <${creds.email}>` : creds.email;
  try {
    const info = await transporter(creds).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      replyTo: creds.email,
      attachments: args.attachments,
      headers: args.headers,
    });
    return { messageId: info.messageId };
  } catch (e) {
    // SMTP session might be stale/broken — drop the cached transporter so the
    // next send rebuilds a fresh connection instead of retrying a dead socket.
    invalidate(creds.email);
    throw e;
  }
}

export async function verifyCredentials(
  creds: AppPasswordSender | { email: string; appPassword: string; fromName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Accept either a typed AppPasswordSender or the raw shape used by the
  // senders POST handler before it knows the auth_method.
  const ap: AppPasswordSender =
    "authMethod" in creds
      ? (creds as AppPasswordSender)
      : { authMethod: "app_password", ...creds };
  try {
    await transporter(ap).verify();
    return { ok: true };
  } catch (e) {
    invalidate(ap.email);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
