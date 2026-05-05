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

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  template: z.string().min(1).optional(),
  from_name: z.string().max(200).optional().nullable(),
  status: z.enum(["draft", "running", "paused", "done"]).optional(),
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
  archived: z.boolean().optional(),
});

// Cap on the recipients fetch returned by the campaign-detail page.
// Higher than this, the UI table is unusable anyway and the polling
// payload becomes the bottleneck. Pagination via ?offset=N for power
// users who need to scroll past it.
const RECIPIENTS_PAGE_SIZE = 1000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data: campaign } = await db.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const offsetParam = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? Math.floor(offsetParam) : 0;
  const limit = RECIPIENTS_PAGE_SIZE;

  const { data: recipients, count } = await db
    .from("recipients")
    .select("*", { count: "exact" })
    .eq("campaign_id", id)
    .order("row_index", { ascending: true })
    .range(offset, offset + limit - 1);

  return NextResponse.json({
    campaign,
    recipients: recipients ?? [],
    pagination: {
      offset,
      limit,
      total: count ?? recipients?.length ?? 0,
      has_more: (count ?? 0) > offset + (recipients?.length ?? 0),
    },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  const db = await supabaseUser();
  const { archived, ...rest } = parsed.data as typeof parsed.data & { archived?: boolean };
  const update: Record<string, unknown> = { ...rest };
  if (archived === true) update.archived_at = new Date().toISOString();
  if (archived === false) update.archived_at = null;
  const { data, error } = await db
    .from("campaigns")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { error } = await db.from("campaigns").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
