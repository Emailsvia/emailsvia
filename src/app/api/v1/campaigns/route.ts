import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, apiOptions, apiError, readJson } from "@/lib/public-api";
import { hasFeature } from "@/lib/billing";
import { isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const DaySchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const StepInput = z.object({
  delay_days: z.number().min(0.5).max(60),
  delay_unit: z.enum(["days", "business_days"]).optional(),
  subject: z.string().max(500).nullable().optional(),
  template: z.string().min(1),
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  template: z.string().min(1),
  sender_id: z.string().uuid(),
  timezone: z.string().refine(isValidTimeZone, "invalid timezone").optional(),
  schedule: z
    .object({ mon: DaySchema, tue: DaySchema, wed: DaySchema, thu: DaySchema, fri: DaySchema, sat: DaySchema, sun: DaySchema })
    .optional(),
  daily_cap: z.number().int().min(1).max(2000).optional(),
  gap_seconds: z.number().int().min(30).max(3600).optional(),
  unsubscribe_enabled: z.boolean().optional(),
  tracking_enabled: z.boolean().optional(),
  strict_merge: z.boolean().optional(),
  stop_on_domain_reply: z.boolean().optional(),
  follow_ups: z.array(StepInput).max(10).optional(),
});

// GET /api/v1/campaigns?status=running — campaigns with recipient counts.
export const GET = withApi(async (req: NextRequest, { userId, db }) => {
  const status = req.nextUrl.searchParams.get("status");
  let q = db
    .from("campaigns")
    .select("id, name, status, paused_reason, subject, sender_id, timezone, daily_cap, follow_ups_enabled, created_at, updated_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (status) q = q.eq("status", status);
  const [{ data: campaigns }, { data: counts }] = await Promise.all([
    q,
    db.rpc("campaign_status_counts", { p_user_id: userId }),
  ]);
  const byId = new Map(((counts ?? []) as Array<{ campaign_id: string; total: number; sent: number; failed: number }>).map((c) => [c.campaign_id, c]));
  return NextResponse.json({
    campaigns: (campaigns ?? []).map((c) => ({
      ...c,
      recipients: byId.get(c.id)?.total ?? 0,
      sent: byId.get(c.id)?.sent ?? 0,
      failed: byId.get(c.id)?.failed ?? 0,
    })),
  });
});

// POST /api/v1/campaigns — create a draft campaign (optionally with follow-ups).
// Add recipients with POST /api/v1/campaigns/:id/recipients, then start it
// with PATCH /api/v1/campaigns/:id {"status":"running"}.
export const POST = withApi(async (req: NextRequest, { userId, plan, db }) => {
  const parsed = CreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError(400, "invalid_request", undefined, { issues: parsed.error.issues });
  const input = parsed.data;

  const { data: sender } = await db.from("senders").select("id").eq("id", input.sender_id).eq("user_id", userId).maybeSingle();
  if (!sender) return apiError(400, "sender_not_found");
  if ((input.follow_ups?.length ?? 0) > 0 && !hasFeature(plan, "follow_ups")) {
    return apiError(402, "follow_ups_not_enabled", `Follow-ups aren't included in the ${plan.name} plan.`);
  }

  const { follow_ups, ...fields } = input;
  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      ...fields,
      user_id: userId,
      status: "draft",
      unsubscribe_enabled: input.unsubscribe_enabled ?? true,
      tracking_enabled: input.tracking_enabled ?? false,
      follow_ups_enabled: (follow_ups?.length ?? 0) > 0,
    })
    .select("id, name, status, created_at")
    .single();
  if (error || !campaign) return apiError(500, "campaign_insert_failed", error?.message);

  if (follow_ups && follow_ups.length > 0) {
    const { error: sErr } = await db.from("follow_up_steps").insert(
      follow_ups.map((s, i) => ({
        campaign_id: campaign.id,
        user_id: userId,
        step_number: i + 1,
        delay_days: s.delay_days,
        delay_unit: s.delay_unit ?? "business_days",
        subject: s.subject ?? null,
        template: s.template,
      }))
    );
    if (sErr) return apiError(500, "follow_up_insert_failed", sErr.message, { campaign_id: campaign.id });
  }
  return NextResponse.json({ campaign }, { status: 201 });
});
