import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";
import { recordEvents } from "@/lib/activity";
import { getUser } from "@/lib/auth-server";
import { mapWithLimit, validateEmail, type MailDomainStatus } from "@/lib/email-validator";
import { verifierConfigured, verifyMailbox, type MailboxVerdict } from "@/lib/mailbox-verifier";
import { getPlan, hasFeature } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 500;
const TIME_BUDGET_MS = 45_000;
// No new paid lookup starts after this, so in-flight ones (10s timeout)
// finish and get saved inside maxDuration.
const VERIFY_BUDGET_MS = 35_000;

const REASON_LABEL: Record<string, string> = {
  bad_syntax: "not a valid email address",
  no_mx: "domain doesn't accept email",
  disposable: "disposable/throwaway inbox",
  mailbox_invalid: "mailbox doesn't exist (verified)",
  mailbox_risky: "spam trap / do-not-mail address (verified)",
};

// Validates the campaign's pending recipients: syntax, disposable domains,
// and a DNS MX lookup (cached per domain, so big lists with few domains are
// fast). Invalid rows become status='skipped' with a readable error: they
// were never emailed, so they must not count as bounces (Bounce Shield and
// bounce-rate stats only look at real bounces). Walks the whole list in
// pages until done or the time budget runs out; run again to continue.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  // Paid mailbox verification when the plan includes it and the operator has
  // configured a provider. Each address is verified once (verified_at).
  const plan = await getPlan(db, u.id);
  const deepVerify = hasFeature(plan, "email_verification") && verifierConfigured() !== null;
  const verdicts = new Map<MailboxVerdict, string[]>();
  let verifyErrors = 0;
  let verifySkipped = 0;

  const started = Date.now();
  const mxCache = new Map<string, Promise<MailDomainStatus>>();
  let uncertain = 0;
  let checked = 0;
  // Keyset cursor on (row_index, id): row_index can repeat (defaults to 0).
  let cursor: { row: number; id: string } | null = null;
  let complete = false;
  let roleCount = 0;
  const invalid: Array<{ id: string; email: string; reason: string }> = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    let q = db
      .from("recipients")
      .select("id, email, row_index, verified_at")
      .eq("campaign_id", id)
      .eq("status", "pending");
    if (cursor) q = q.or(`row_index.gt.${cursor.row},and(row_index.eq.${cursor.row},id.gt.${cursor.id})`);
    const { data: page } = await q
      .order("row_index", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE);
    if (!page || page.length === 0) { complete = true; break; }
    const results = await mapWithLimit(page, 20, async (r) => ({ r, result: await validateEmail(r.email, mxCache) }));
    const toVerify: Array<{ id: string; email: string }> = [];
    for (const { r, result } of results) {
      if (!result.ok) invalid.push({ id: r.id, email: r.email, reason: result.reason });
      else {
        if (result.role) roleCount++;
        if (result.uncertain) uncertain++;
        else if (deepVerify && !r.verified_at) toVerify.push(r);
      }
    }
    if (toVerify.length > 0) {
      await mapWithLimit(toVerify, 5, async (r) => {
        if (Date.now() - started > VERIFY_BUDGET_MS) { verifySkipped++; return; }
        try {
          const v = await verifyMailbox(r.email);
          // Save immediately: a paid result must survive the function
          // being cut off later in this request.
          await db.from("recipients").update({ verification: v, verified_at: new Date().toISOString() }).eq("id", r.id);
          verdicts.set(v, [...(verdicts.get(v) ?? []), r.id]);
          if (v === "invalid") invalid.push({ id: r.id, email: r.email, reason: "mailbox_invalid" });
          if (v === "risky") invalid.push({ id: r.id, email: r.email, reason: "mailbox_risky" });
        } catch {
          verifyErrors++; // left unverified; the next run tries again
        }
      });
    }
    checked += page.length;
    const last = page[page.length - 1];
    cursor = { row: last.row_index, id: last.id };
    if (page.length < PAGE) { complete = true; break; }
  }

  // Group updates by reason: one request per reason instead of per row.
  const byReason = new Map<string, string[]>();
  for (const b of invalid) byReason.set(b.reason, [...(byReason.get(b.reason) ?? []), b.id]);
  for (const [reason, ids] of byReason) {
    for (let i = 0; i < ids.length; i += 200) {
      const detail = `invalid: ${REASON_LABEL[reason] ?? reason}`;
      const { data: skipped } = await db
        .from("recipients")
        .update({ status: "skipped", error: detail })
        .in("id", ids.slice(i, i + 200))
        .eq("status", "pending")
        .select("id");
      // Server-written log; these rows were just updated through RLS.
      await recordEvents(
        supabaseAdmin(),
        (skipped ?? []).map((r) => ({
          user_id: u.id,
          campaign_id: id,
          recipient_id: r.id,
          type: "skipped" as const,
          data: { reason: "invalid_address", detail, check: reason },
          dedupe_key: "skipped:invalid_address",
        }))
      );
    }
  }

  return NextResponse.json({
    checked,
    invalid: invalid.length,
    invalid_emails: invalid.slice(0, 20).map((b) => b.email),
    by_reason: Object.fromEntries(Array.from(byReason, ([k, v]) => [k, v.length])),
    role_addresses: roleCount,
    complete: complete && verifySkipped === 0 && verifyErrors === 0,
    // DNS didn't answer in time; these were left pending (not skipped).
    uncertain,
    verification: deepVerify
      ? {
          verified: Array.from(verdicts.values()).reduce((n, ids) => n + ids.length, 0),
          catch_all: verdicts.get("catch_all")?.length ?? 0,
          unknown: verdicts.get("unknown")?.length ?? 0,
          errors: verifyErrors,
        }
      : null,
  });
}
