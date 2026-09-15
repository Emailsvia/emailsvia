import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { getAiProvider } from "@/lib/ai-provider";
import { getPlan, hasFeature } from "@/lib/billing";
import { render } from "@/lib/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You draft the sender's answer to a reply they received on a cold email. The human reviews and edits your draft before anything is sent.

Rules:
- Plain text only. No subject line, no markdown headings, no placeholders like "[Your Name]" except where noted below.
- Short: 30–90 words. Sound like a busy, friendly professional, not a marketer. No exclamation marks, no "I hope this finds you well".
- Answer what they actually said. Use ONLY facts found in the original email or the prospect's reply. Never invent prices, features, customers, dates or numbers. If answering needs a fact you don't have, write a short bracketed note for the sender, e.g. [add pricing for 10 seats].
- interested / asking for a call: propose a next step. If a meeting link is given, offer it in one sentence; otherwise suggest two concrete times as [two times that suit you].
- question: answer from the original email if possible, otherwise the bracketed note, then a light next step.
- not now / not interested: one or two gracious sentences, no pushback, no follow-up ask.
- unsubscribe: one sentence confirming they won't hear from you again. Nothing else.
- Match their language (reply in the language they wrote in) and roughly their formality.
- End with the sender's first name on its own line if known.
Output only the email body.`;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const plan = await getPlan(db, u.id);
  if (!hasFeature(plan, "ai")) {
    return NextResponse.json({ error: "AI drafts are available on Growth and Scale." }, { status: 402 });
  }
  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json({ error: "No AI provider is configured on the server." }, { status: 503 });
  }

  const { data: reply } = await db
    .from("replies")
    .select(`
      id, from_email, subject, body_text, snippet, intent,
      recipient:recipients(name, company, vars),
      campaign:campaigns(subject, template, from_name, sender_id)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!reply) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const recipient = (Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient) as {
    name: string | null; company: string | null; vars: Record<string, string> | null;
  } | null;
  const campaign = (Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign) as {
    subject: string; template: string; from_name: string | null; sender_id: string | null;
  } | null;

  const [{ data: settings }, { data: sender }] = await Promise.all([
    db.from("user_settings").select("meeting_link").eq("user_id", u.id).maybeSingle(),
    campaign?.sender_id
      ? db.from("senders").select("from_name").eq("id", campaign.sender_id).maybeSingle()
      : Promise.resolve({ data: null as { from_name: string | null } | null }),
  ]);

  const vars = { ...(recipient?.vars ?? {}), Name: recipient?.name ?? "", Company: recipient?.company ?? "" };
  const original = campaign ? render(campaign.template, vars).slice(0, 2000) : "(not available)";
  // Strip the quoted history most clients append, so the model reads what
  // they actually wrote this time.
  const theirText = (reply.body_text ?? reply.snippet ?? "")
    .split(/\n(?:On .{5,120}wrote:|-{2,} ?Original Message|From: )/i)[0]
    .slice(0, 2000);
  const senderName = (sender?.from_name || campaign?.from_name || "").trim();

  const user = [
    `Sender's name: ${senderName || "(unknown)"}`,
    `Meeting link: ${settings?.meeting_link || "(none)"}`,
    `Prospect: ${recipient?.name || reply.from_email}${recipient?.company ? ` at ${recipient.company}` : ""}`,
    `Reply label: ${reply.intent ?? "unlabelled"}`,
    ``,
    `--- Original email the sender wrote (subject: ${campaign?.subject ?? ""}) ---`,
    original,
    ``,
    `--- Prospect's reply (subject: ${reply.subject ?? ""}) ---`,
    theirText || "(empty)",
  ].join("\n");

  const out = await provider.complete({ system: SYSTEM_PROMPT, user, maxTokens: 400 });
  const draft = out?.text?.trim();
  if (!draft) return NextResponse.json({ error: "The AI provider didn't return a draft. Try again." }, { status: 502 });

  await db.from("replies").update({ ai_draft: draft, ai_draft_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ draft });
}
