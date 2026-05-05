import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { extractApiKey, authenticateApiKey } from "@/lib/api-key";
import { getPlanForUser, importRowLimit, hasFeature } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Public API — open CORS so browser SDKs / Apps Script side-channels
// can call it. The Bearer-token auth is the actual security boundary;
// CORS is just enabling cross-origin client access.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

// Public-API endpoint: create a campaign + recipients in a single call.
// Driven by the Google Sheets add-on (Phase 2): the user picks a sheet,
// we POST the rows here, the campaign appears in their dashboard ready
// to start.
//
// Auth: Bearer token (an `eav_live_...` key from /app/keys), NOT the
// browser session — the add-on runs in Apps Script, not in our origin.
//
// Plan gating mirrors the web flow: free-tier users get capped at the
// import-row limit (100), paid users go up to 50K rows in one POST.

const RowSchema = z
  .object({
    email: z.string().email(),
    name: z.string().optional().default(""),
    company: z.string().optional().default(""),
  })
  .passthrough(); // extra columns become merge tags (vars)

const Schema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  from_name: z.string().max(200).optional().nullable(),
  sender_id: z.string().uuid().nullable().optional(),
  follow_ups_enabled: z.boolean().optional(),
  tracking_enabled: z.boolean().optional(),
  unsubscribe_enabled: z.boolean().optional(),
  strict_merge: z.boolean().optional(),
  daily_cap: z.number().int().min(1).max(2000).optional(),
  // Active rows from the Sheet. Each row needs at minimum `email`; other
  // fields are optional and pass through as `vars` for {{...}} merge.
  rows: z.array(RowSchema).min(1).max(50000),
});

export async function POST(req: NextRequest) {
  return withCors(await handle(req));
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // ---- auth ----
  const rawToken = extractApiKey(req.headers.get("authorization"));
  if (!rawToken) return NextResponse.json({ error: "missing_api_key" }, { status: 401 });
  const auth = await authenticateApiKey(rawToken);
  if (!auth) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });

  // ---- parse + validate ----
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // ---- plan gate: public_api feature ----
  // Sheets add-on + direct API both call this endpoint. Public API access
  // is a Scale-tier feature; lower tiers get a clean upgrade message
  // (Sheets add-on flow only available on Scale).
  const db = supabaseAdmin();
  const { plan } = await getPlanForUser(db, auth.user_id);
  if (!hasFeature(plan, "public_api")) {
    return NextResponse.json(
      {
        error: "public_api_not_enabled",
        message: `Public API + Sheets add-on require the Scale plan. Your current plan is ${plan.name}.`,
        plan: plan.id,
      },
      { status: 402 }
    );
  }

  // ---- plan gate: row count ----
  const rowLimit = importRowLimit(plan);
  if (rowLimit !== null && input.rows.length > rowLimit) {
    return NextResponse.json(
      {
        error: "row_limit_exceeded",
        message: `Your ${plan.name} plan caps imports at ${rowLimit} rows. Upgrade or split the sheet.`,
        limit: rowLimit,
        sent: input.rows.length,
      },
      { status: 402 }
    );
  }

  // ---- sender check (if provided, must belong to caller) ----
  if (input.sender_id) {
    const { data: sender } = await db
      .from("senders")
      .select("id")
      .eq("id", input.sender_id)
      .eq("user_id", auth.user_id)
      .maybeSingle();
    if (!sender) return NextResponse.json({ error: "sender_not_found" }, { status: 400 });
  }

  // ---- create campaign ----
  // Pull merge-tag column names from the first row (every row is the same
  // shape — Sheets gives us a homogenous header set).
  const knownVars = Array.from(
    new Set(
      Object.keys(input.rows[0]).filter(
        (k) => k !== "email" && k !== "name" && k !== "company"
      )
    )
  );

  const { data: campaign, error: cErr } = await db
    .from("campaigns")
    .insert({
      user_id: auth.user_id,
      name: input.name,
      subject: input.subject,
      template: input.template,
      from_name: input.from_name ?? null,
      sender_id: input.sender_id ?? null,
      status: "draft",
      daily_cap: input.daily_cap ?? plan.daily_cap,
      follow_ups_enabled: input.follow_ups_enabled ?? false,
      tracking_enabled: input.tracking_enabled ?? true,
      unsubscribe_enabled: input.unsubscribe_enabled ?? true,
      strict_merge: input.strict_merge ?? true,
      known_vars: knownVars,
    })
    .select("id")
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: cErr?.message ?? "campaign_insert_failed" }, { status: 500 });
  }

  // ---- bulk insert recipients ----
  // Dedupe by lowercase email (the Sheet may have duplicates), and assign
  // row_index so the order in the Sheet is preserved on the dashboard.
  const seen = new Set<string>();
  const recipientRows = input.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const lo = r.email.toLowerCase();
      if (seen.has(lo)) return false;
      seen.add(lo);
      return true;
    })
    .map(({ r, i }) => {
      const { email, name, company, ...rest } = r;
      return {
        campaign_id: campaign.id,
        user_id: auth.user_id,
        name: name || "",
        company: company || "",
        email: email.toLowerCase(),
        vars: rest as Record<string, string>,
        row_index: i,
      };
    });

  // Chunk inserts to keep individual round-trips small. 1000/batch is
  // comfortable for Supabase's row limits.
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < recipientRows.length; i += CHUNK) {
    const slice = recipientRows.slice(i, i + CHUNK);
    const { error: rErr, count } = await db
      .from("recipients")
      .insert(slice, { count: "exact" });
    if (rErr) {
      // Half-inserted state is acceptable here — the user can clear and
      // re-import. We surface the error so the add-on can show it.
      return NextResponse.json(
        {
          error: "recipient_insert_failed",
          message: rErr.message,
          partial_inserted: inserted,
        },
        { status: 500 }
      );
    }
    inserted += count ?? slice.length;
  }

  return NextResponse.json({
    ok: true,
    campaign_id: campaign.id,
    recipient_count: inserted,
    duplicates_skipped: input.rows.length - inserted,
  });
}
