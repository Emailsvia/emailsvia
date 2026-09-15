import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, apiOptions, apiError, readJson, intParam } from "@/lib/public-api";
import { importRowLimit } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const OPTIONS = apiOptions;

type P = { id: string };

const RowSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().optional().default(""),
    company: z.string().optional().default(""),
  })
  .passthrough(); // any other field becomes a {{merge tag}}

const AddSchema = z.object({ rows: z.array(RowSchema).min(1).max(10_000) });

// GET /api/v1/campaigns/:id/recipients?status=replied&limit=100&offset=0
export const GET = withApi<P>(async (req: NextRequest, { userId, db }, { id }) => {
  const limit = intParam(req, "limit", 100, 1, 500);
  const offset = intParam(req, "offset", 0, 0, 1_000_000);
  const status = req.nextUrl.searchParams.get("status");
  let q = db
    .from("recipients")
    .select(
      "id, email, name, company, vars, status, stop_reason, follow_up_count, next_step_number, next_follow_up_at, sent_at, replied_at, error, row_index",
      { count: "exact" }
    )
    .eq("campaign_id", id)
    .eq("user_id", userId)
    .order("row_index", { ascending: true })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq("status", status);
  const { data, count, error } = await q;
  if (error) return apiError(500, "query_failed", error.message);
  return NextResponse.json({ recipients: data ?? [], total: count ?? 0, limit, offset });
});

// POST /api/v1/campaigns/:id/recipients {"rows":[{"email":…,"name":…,"company":…,…}]}
// Adds recipients; addresses already in the campaign are left untouched.
export const POST = withApi<P>(async (req: NextRequest, { userId, plan, db }, { id }) => {
  const parsed = AddSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError(400, "invalid_request", undefined, { issues: parsed.error.issues.slice(0, 20) });
  const { data: campaign } = await db.from("campaigns").select("id, known_vars").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!campaign) return apiError(404, "not_found");

  const limit = importRowLimit(plan);
  if (limit !== null && parsed.data.rows.length > limit) {
    return apiError(402, "row_limit_exceeded", `Your ${plan.name} plan caps imports at ${limit} rows.`, { limit });
  }

  const { data: last } = await db
    .from("recipients")
    .select("row_index")
    .eq("campaign_id", id)
    .order("row_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const start = (last?.row_index ?? -1) + 1;

  const seen = new Set<string>();
  const rows = parsed.data.rows
    .filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)))
    .map((r, i) => {
      const { email, name, company, ...rest } = r;
      const vars = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v == null ? "" : String(v)]));
      return { campaign_id: id, user_id: userId, email, name: name || "", company: company || "", vars, row_index: start + i };
    });

  let added = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { data, error } = await db
      .from("recipients")
      .upsert(rows.slice(i, i + 1000), { onConflict: "campaign_id,email", ignoreDuplicates: true })
      .select("id");
    if (error) return apiError(500, "insert_failed", error.message, { added });
    added += data?.length ?? 0;
  }

  // Remember new column names so the campaign editor offers them as tags.
  const known = new Set<string>(campaign.known_vars ?? []);
  const before = known.size;
  for (const r of rows) for (const k of Object.keys(r.vars)) known.add(k);
  if (known.size !== before) await db.from("campaigns").update({ known_vars: Array.from(known) }).eq("id", id).eq("user_id", userId);

  return NextResponse.json({ added, already_in_campaign: parsed.data.rows.length - added });
});
