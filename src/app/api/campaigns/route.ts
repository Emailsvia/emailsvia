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

  // Count per campaign. Using head:true count queries so we don't transfer
  // rows — just totals. Parallelized so it's still one round-trip of latency.
  const enriched = await Promise.all(
    (campaigns ?? []).map(async (c) => {
      const [total, sent, failed] = await Promise.all([
        db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id),
        db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["sent", "replied"]),
        db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["failed", "bounced"]),
      ]);
      return {
        ...c,
        total: total.count ?? 0,
        sent: sent.count ?? 0,
        failed: failed.count ?? 0,
      };
    })
  );
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
