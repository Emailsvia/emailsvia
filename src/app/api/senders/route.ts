import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { verifyCredentials, type HostConfig } from "@/lib/mail";
import { getUser } from "@/lib/auth-server";
import { encryptSecret } from "@/lib/crypto";
import { SendAsEmail } from "@/lib/sender-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom SMTP/IMAP hosts are user-supplied and we open sockets to them from
// our servers. Require a public-looking DNS name: no IP literals, no
// localhost, no single-label/internal names. (Doesn't stop DNS that resolves
// to a private IP — acceptable for now, ports are limited to mail ports.)
const mailHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Enter a mail server hostname like mail.example.com")
  .refine((h) => !/(^|\.)(localhost|local|internal|localdomain)$/.test(h), "Internal hostnames aren't allowed");

const SMTP_PORTS = [465, 587, 2525] as const;
const IMAP_PORTS = [993, 143] as const;

const Common = {
  label: z.string().min(1, "Label is required").max(100),
  email: z.string().email("Invalid email").transform((v) => v.toLowerCase()),
  from_name: z.string().max(200).optional().nullable(),
  is_default: z.boolean().optional(),
  warmup_enabled: z.boolean().optional(),
  send_as_email: SendAsEmail,
};

const GmailSchema = z.object({
  ...Common,
  provider: z.literal("gmail").optional().default("gmail"),
  app_password: z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .length(16, "App password must be exactly 16 characters — that's the format Google generates. Not your Gmail login password.")
        .regex(/^[a-z]+$/i, "App password should be only letters (no digits, no special characters). Generate a new one at myaccount.google.com/apppasswords.")
    ),
});

const SmtpSchema = z.object({
  ...Common,
  provider: z.literal("smtp"),
  // Mailbox password — kept verbatim (spaces can be legitimate here).
  app_password: z.string().min(1, "Password is required").max(500),
  smtp_host: mailHost,
  smtp_port: z.number().int().refine((p) => (SMTP_PORTS as readonly number[]).includes(p), "SMTP port must be 465, 587 or 2525"),
  smtp_secure: z.boolean(),
  imap_host: mailHost,
  imap_port: z.number().int().refine((p) => (IMAP_PORTS as readonly number[]).includes(p), "IMAP port must be 993 or 143"),
  imap_secure: z.boolean(),
});

const CreateSchema = z.union([SmtpSchema, GmailSchema]);

const RETURN_COLUMNS =
  "id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, auth_method, oauth_status, provider, smtp_host, send_as_email, created_at";

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("senders")
    .select(RETURN_COLUMNS)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ senders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  // Pick the schema by provider up front so errors come from the right one
  // (a union would report both branches' issues).
  const parsed = (body?.provider === "smtp" ? SmtpSchema : GmailSchema).safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const d: z.infer<typeof CreateSchema> = parsed.data;
  const { label, email, app_password: pw, from_name, is_default, warmup_enabled } = d;

  let smtp: HostConfig | undefined;
  let imap: HostConfig | undefined;
  if (d.provider === "smtp") {
    smtp = { host: d.smtp_host, port: d.smtp_port, secure: d.smtp_secure };
    imap = { host: d.imap_host, port: d.imap_port, secure: d.imap_secure };
  }

  // verify SMTP (and IMAP for custom senders) login works before saving
  const v = await verifyCredentials({ email, appPassword: pw, smtp, imap });
  if (!v.ok) return NextResponse.json({ error: `verify_failed: ${v.error}` }, { status: 400 });

  const db = await supabaseUser();
  if (is_default) {
    await db.from("senders").update({ is_default: false }).eq("is_default", true);
  }
  const { data, error } = await db
    .from("senders")
    .insert({
      user_id: u.id,
      label,
      email,
      auth_method: "app_password",
      app_password: encryptSecret(pw),
      from_name: from_name ?? null,
      is_default: !!is_default,
      warmup_enabled: !!warmup_enabled,
      warmup_started_at: warmup_enabled ? new Date().toISOString() : null,
      provider: d.provider,
      send_as_email: d.send_as_email ?? null,
      smtp_host: smtp?.host ?? null,
      smtp_port: smtp?.port ?? null,
      smtp_secure: smtp?.secure ?? null,
      imap_host: imap?.host ?? null,
      imap_port: imap?.port ?? null,
      imap_secure: imap?.secure ?? null,
    })
    .select(RETURN_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sender: data });
}
