import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { sendMail, serversFromRow, SENDER_SERVER_COLUMNS, type SenderCreds } from "@/lib/mail";
import { render, spin, toHtml, toPlain } from "@/lib/template";
import { getUser } from "@/lib/auth-server";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { downloadAttachment } from "@/lib/attachment";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  sender_id: z.string().uuid().nullable().optional(),
  vars: z.record(z.string()).optional(),
  campaign_id: z.string().uuid().nullable().optional(),
  // Optional follow-up steps: sent right after the first email, threaded
  // exactly like the real sequence, so the tester sees the whole thread.
  steps: z
    .array(z.object({ subject: z.string().max(500).nullable().optional(), template: z.string().min(1) }))
    .max(10)
    .optional(),
});

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB per file

type Attachment = { filename: string; content: Buffer };

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Operator-suspended tenants are blocked from sending anything, including
  // test sends. The user can still log in and explore — they just can't put
  // mail on the wire.
  const { data: suspended } = await supabaseAdmin()
    .from("subscriptions")
    .select("suspended_at")
    .eq("user_id", u.id)
    .maybeSingle();
  if (suspended?.suspended_at) {
    return NextResponse.json({ error: "account_suspended" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  let raw: Record<string, unknown>;
  const pendingFiles: File[] = [];

  if (isMultipart) {
    const form = await req.formData();
    const varsStr = form.get("vars");
    const stepsStr = form.get("steps");
    raw = {
      to: form.get("to"),
      subject: form.get("subject"),
      template: form.get("template"),
      sender_id: form.get("sender_id") || null,
      campaign_id: form.get("campaign_id") || null,
      vars: typeof varsStr === "string" && varsStr ? JSON.parse(varsStr) : undefined,
      steps: typeof stepsStr === "string" && stepsStr ? JSON.parse(stepsStr) : undefined,
    };
    for (const entry of form.getAll("file")) {
      if (entry instanceof File && entry.size > 0) pendingFiles.push(entry);
    }
  } else {
    raw = await req.json().catch(() => ({}));
  }

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const db = await supabaseUser();

  // resolve sender (app-password OR oauth)
  let sender: SenderCreds | null = null;
  let senderRowId: string | null = null;
  if (parsed.data.sender_id) {
    const { data: row } = await db
      .from("senders")
      .select(`id, email, app_password, from_name, auth_method, oauth_refresh_token, oauth_access_token, oauth_expires_at, ${SENDER_SERVER_COLUMNS}`)
      .eq("id", parsed.data.sender_id)
      .maybeSingle();
    if (row) {
      senderRowId = row.id;
      if (row.auth_method === "oauth" && row.oauth_refresh_token) {
        sender = {
          authMethod: "oauth",
          email: row.email,
          fromName: row.from_name,
          refreshToken: decryptSecret(row.oauth_refresh_token),
          accessToken: row.oauth_access_token ? decryptSecret(row.oauth_access_token) : null,
          expiresAt: row.oauth_expires_at ? new Date(row.oauth_expires_at) : null,
          sendAs: row.send_as_email ?? null,
        };
      } else if (row.app_password) {
        sender = {
          authMethod: "app_password",
          email: row.email,
          fromName: row.from_name,
          appPassword: decryptSecret(row.app_password),
          sendAs: row.send_as_email ?? null,
          ...serversFromRow(row),
        };
      }
    }
  }

  // collect attachments: pending files from form + existing from campaign (if given)
  const attachments: Attachment[] = [];

  for (const f of pendingFiles) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `"${f.name}" exceeds 20MB limit.` }, { status: 413 });
    }
    const ab = await f.arrayBuffer();
    attachments.push({ filename: f.name, content: Buffer.from(ab) });
    if (attachments.length >= MAX_ATTACHMENTS) break;
  }

  if (parsed.data.campaign_id && attachments.length < MAX_ATTACHMENTS) {
    const { data: camp } = await db
      .from("campaigns")
      .select("attachment_paths, attachment_filenames, attachment_path, attachment_filename")
      .eq("id", parsed.data.campaign_id)
      .maybeSingle();
    if (camp) {
      const paths: string[] = camp.attachment_paths ?? [];
      const names: string[] = camp.attachment_filenames ?? [];
      if (paths.length > 0) {
        const loaded = await Promise.all(
          paths.map((p, i) => downloadAttachment(db, p, names[i] ?? "attachment"))
        );
        for (const a of loaded) {
          if (a && attachments.length < MAX_ATTACHMENTS) attachments.push(a);
        }
      } else if (camp.attachment_path && camp.attachment_filename) {
        const a = await downloadAttachment(db, camp.attachment_path, camp.attachment_filename);
        if (a && attachments.length < MAX_ATTACHMENTS) attachments.push(a);
      }
    }
  }

  if (!sender) {
    return NextResponse.json(
      { error: "no_sender", message: "Pick a sender (or connect one in /app/senders) before sending a test." },
      { status: 400 }
    );
  }

  const vars = parsed.data.vars ?? { Name: "Test", Company: "Your Company" };
  // Fresh spintax pick per test so repeated tests show the variations.
  const seed = `test:${Date.now()}`;
  const subject = `[TEST] ${render(spin(parsed.data.subject, `${seed}:subject`), vars)}`;
  const rendered = render(spin(parsed.data.template, seed), vars);
  const html = toHtml(rendered);
  const text = toPlain(rendered);

  try {
    const result = await sendMail({
      to: parsed.data.to,
      subject,
      text,
      html,
      sender,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    let latestTokens = result.tokensRefreshed ?? null;

    // Follow-up steps: same threading the tick uses (In-Reply-To/References
    // to the first message, "Re:" subject, Gmail threadId for OAuth).
    const steps = parsed.data.steps ?? [];
    const firstMsgId = result.messageId
      ? result.messageId.startsWith("<") ? result.messageId : `<${result.messageId}>`
      : null;
    for (const step of steps) {
      const stepSubject = render(spin(step.subject || parsed.data.subject, `${seed}:subject`), vars).replace(/^re:\s*/i, "");
      const stepBody = render(spin(step.template, seed), vars);
      const stepSender: SenderCreds =
        sender.authMethod === "oauth" && latestTokens
          ? { ...sender, accessToken: latestTokens.accessToken, expiresAt: latestTokens.expiresAt }
          : sender;
      const r = await sendMail({
        to: parsed.data.to,
        subject: `Re: [TEST] ${stepSubject}`,
        text: toPlain(stepBody),
        html: toHtml(stepBody),
        sender: stepSender,
        headers: firstMsgId ? { "In-Reply-To": firstMsgId, References: firstMsgId } : undefined,
        threadId: result.threadId ?? null,
      });
      if (r.tokensRefreshed) latestTokens = r.tokensRefreshed;
    }

    // Persist a refreshed OAuth token if Gmail handed us a new one mid-send.
    if (senderRowId && latestTokens) {
      await supabaseAdmin()
        .from("senders")
        .update({
          oauth_access_token: encryptSecret(latestTokens.accessToken),
          oauth_expires_at: latestTokens.expiresAt.toISOString(),
        })
        .eq("id", senderRowId);
    }
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      attached: attachments.length,
      follow_ups_sent: steps.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
