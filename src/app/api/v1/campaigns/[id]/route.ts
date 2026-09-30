import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, apiOptions, apiError, readJson } from "@/lib/public-api";
import { loadRules } from "@/lib/followup-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type P = { id: string };

// GET /api/v1/campaigns/:id — campaign, follow-up steps and funnel counts.
export const GET = withApi<P>(async (_req: NextRequest, { userId, db }, { id }) => {
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, status, paused_reason, subject, template, sender_id, timezone, schedule, daily_cap, gap_seconds, follow_ups_enabled, unsubscribe_enabled, tracking_enabled, strict_merge, stop_on_domain_reply, max_follow_ups, min_gap_days, send_time_optimization, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!campaign) return apiError(404, "not_found");
  const rules = await loadRules(db, id);

  const count = async (statuses: string[]) => {
    const { count } = await db
      .from("recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", id)
      .eq("user_id", userId)
      .in("status", statuses);
    return count ?? 0;
  };
  const [pending, sent, replied, bounced, unsubscribed, skipped, failed, steps] = await Promise.all([
    count(["pending"]),
    count(["sent", "replied"]),
    count(["replied"]),
    count(["bounced"]),
    count(["unsubscribed"]),
    count(["skipped"]),
    count(["failed"]),
    db.from("follow_up_steps").select("step_number, delay_days, delay_unit, subject, template, condition").eq("campaign_id", id).eq("user_id", userId).order("step_number"),
  ]);
  return NextResponse.json({
    campaign,
    follow_ups: steps.data ?? [],
    rules,
    stats: {
      pending, sent, replied, bounced, unsubscribed, skipped, failed,
      reply_rate: sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
    },
  });
});

const PatchSchema = z.object({
  status: z.enum(["running", "paused"]).optional(),
  name: z.string().min(1).max(200).optional(),
  daily_cap: z.number().int().min(1).max(2000).optional(),
});

// PATCH /api/v1/campaigns/:id — start/pause, rename, change daily cap.
export const PATCH = withApi<P>(async (req: NextRequest, { userId, db }, { id }) => {
  const parsed = PatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError(400, "invalid_request", undefined, { issues: parsed.error.issues });
  const { data: campaign } = await db.from("campaigns").select("id, sender_id, status").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!campaign) return apiError(404, "not_found");

  if (parsed.data.status === "running") {
    const { count: rotation } = await db.from("campaign_senders").select("*", { count: "exact", head: true }).eq("campaign_id", id);
    if (!campaign.sender_id && !rotation) return apiError(409, "no_sender", "Attach a sender before starting.");
    const [{ count: pending }, { count: followUps }] = await Promise.all([
      db.from("recipients").select("*", { count: "exact", head: true }).eq("campaign_id", id).eq("user_id", userId).eq("status", "pending"),
      db
        .from("recipients")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", id)
        .eq("user_id", userId)
        .eq("status", "sent")
        .not("next_follow_up_at", "is", null),
    ]);
    // Resuming a campaign whose first emails are all out is fine as long as
    // follow-ups are still scheduled.
    if (!pending && !followUps) {
      return apiError(409, "nothing_to_send", "Add recipients before starting; nothing is pending or scheduled.");
    }
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) update.paused_reason = null;
  const { data, error } = await db
    .from("campaigns")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, name, status, daily_cap, updated_at")
    .single();
  if (error) return apiError(500, "update_failed", error.message);
  return NextResponse.json({ campaign: data });
});
