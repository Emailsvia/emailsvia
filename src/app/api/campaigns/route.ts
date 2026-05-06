import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DayScheduleSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
const ScheduleSchema = z.object({
  mon: DayScheduleSchema, tue: DayScheduleSchema, wed: DayScheduleSchema,
  thu: DayScheduleSchema, fri: DayScheduleSchema, sat: DayScheduleSchema, sun: DayScheduleSchema,
}).nullable().optional();

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  from_name: z.string().max(200).optional().nullable(),
  sender_id: z.string().uuid().nullable().optional(),
  schedule: ScheduleSchema,
  daily_cap: z.number().int().min(1).max(2000).optional(),
  gap_seconds: z.number().int().min(30).max(3600).optional(),
  window_start_hour: z.number().int().min(0).max(23).optional(),
  window_end_hour: z.number().int().min(1).max(24).optional(),
  timezone: z.string().optional(),
  follow_ups_enabled: z.boolean().optional(),
  retry_enabled: z.boolean().optional(),
  max_retries: z.number().int().min(1).max(5).optional(),
  tracking_enabled: z.boolean().optional(),
  unsubscribe_enabled: z.boolean().optional(),
  strict_merge: z.boolean().optional(),
  start_at: z.string().datetime().nullable().optional(),
  // A/B testing — at most 4 variants. Each {id, weight, subject, template}.
  variants: z.array(z.object({
    id: z.string().min(1).max(40),
    weight: z.number().int().min(1).max(100).optional().default(1),
    subject: z.string().min(1).max(500),
    template: z.string().min(1),
  })).min(2).max(4).nullable().optional(),
  ab_winner_threshold: z.number().int().min(50).max(10000).nullable().optional(),
  ab_winner_id: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  const db = await supabaseUser();
  let q = db.from("campaigns").select("*").order("created_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data: campaigns, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Per-campaign counts via the campaign_status_counts() Postgres
  // function — one indexed aggregation, vs the previous N+1 of three
  // head-count queries per campaign. Function is SECURITY INVOKER so
  // RLS applies through the supabaseUser() JWT.
  type CountRow = { campaign_id: string; total: number; sent: number; failed: number };
  const buckets = new Map<string, { total: number; sent: number; failed: number }>();
  const { data: countsRaw } = await db.rpc("campaign_status_counts", { p_user_id: u.id });
  for (const row of (countsRaw ?? []) as CountRow[]) {
    buckets.set(row.campaign_id, {
      total: row.total,
      sent: row.sent,
      failed: row.failed,
    });
  }
  const enriched = (campaigns ?? []).map((c) => ({
    ...c,
    ...(buckets.get(c.id) ?? { total: 0, sent: 0, failed: 0 }),
  }));
  return NextResponse.json({ campaigns: enriched });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const db = await supabaseUser();
  const { data, error } = await db.from("campaigns").insert({ ...parsed.data, user_id: u.id }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
