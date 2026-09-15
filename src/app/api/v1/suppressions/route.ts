import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, apiOptions, apiError, readJson, intParam } from "@/lib/public-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

const AddSchema = z.object({
  emails: z.array(z.string()).max(5000).optional(),
  domains: z.array(z.string()).max(5000).optional(),
});

// GET /api/v1/suppressions?limit=500&offset=0 — the do-not-contact list.
export const GET = withApi(async (req: NextRequest, { userId, db }) => {
  const limit = intParam(req, "limit", 500, 1, 2000);
  const offset = intParam(req, "offset", 0, 0, 1_000_000);
  const { data, error } = await db
    .from("suppressions")
    .select("kind, value, reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return apiError(500, "query_failed", error.message);
  return NextResponse.json({ suppressions: data ?? [] });
});

// POST /api/v1/suppressions {"emails":["a@b.com"],"domains":["customer.com"]}
// Nobody on the list is emailed by any campaign (e.g. sync your CRM's
// customers so they never get cold outreach).
export const POST = withApi(async (req: NextRequest, { userId, db }) => {
  const parsed = AddSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError(400, "invalid_request");
  const rows: Array<{ user_id: string; kind: string; value: string; reason: string }> = [];
  const invalid: string[] = [];
  for (const e of parsed.data.emails ?? []) {
    const v = e.trim().toLowerCase();
    if (EMAIL_RE.test(v)) rows.push({ user_id: userId, kind: "email", value: v, reason: "import" });
    else invalid.push(e);
  }
  for (const d of parsed.data.domains ?? []) {
    const v = d.trim().toLowerCase().replace(/^@/, "");
    if (DOMAIN_RE.test(v)) rows.push({ user_id: userId, kind: "domain", value: v, reason: "import" });
    else invalid.push(d);
  }
  if (rows.length === 0) return apiError(400, "nothing_valid", undefined, { invalid: invalid.slice(0, 50) });
  const { error } = await db.from("suppressions").upsert(rows, { onConflict: "user_id,kind,value", ignoreDuplicates: true });
  if (error) return apiError(500, "insert_failed", error.message);
  return NextResponse.json({ accepted: rows.length, invalid: invalid.slice(0, 50) });
});
