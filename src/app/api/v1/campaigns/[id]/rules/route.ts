import { NextRequest, NextResponse } from "next/server";
import { withApi, apiOptions, apiError, readJson } from "@/lib/public-api";
import { hasFeature } from "@/lib/billing";
import { loadRules, normaliseRuleParams, SaveRulesSchema } from "@/lib/followup-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type P = { id: string };

// GET /api/v1/campaigns/:id/rules — activity-based follow-up rules + limits.
export const GET = withApi<P>(async (_req: NextRequest, { userId, db }, { id }) => {
  const { data: camp } = await db
    .from("campaigns")
    .select("id, max_follow_ups, min_gap_days, send_time_optimization")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!camp) return apiError(404, "not_found");
  return NextResponse.json({
    rules: await loadRules(db, id),
    max_follow_ups: camp.max_follow_ups,
    min_gap_days: Number(camp.min_gap_days),
    send_time_optimization: camp.send_time_optimization,
  });
});

// PUT /api/v1/campaigns/:id/rules — replace all rules atomically. Send rule
// and email ids back to keep each person's progress through a rule.
export const PUT = withApi<P>(async (req: NextRequest, { userId, plan, db }, { id }) => {
  const parsed = SaveRulesSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError(400, "invalid_request", undefined, { issues: parsed.error.issues });
  // Ownership first: the service-role client bypasses RLS.
  const { data: camp } = await db.from("campaigns").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!camp) return apiError(404, "not_found");
  const { rules, max_follow_ups, min_gap_days, send_time_optimization } = parsed.data;
  if ((rules.length > 0 || send_time_optimization) && !(hasFeature(plan, "follow_ups") && hasFeature(plan, "conditional_sequences"))) {
    return apiError(402, "rules_not_enabled", "Follow-up rules and send-time optimisation are available on Growth and Scale.");
  }
  const { data: rechecked, error } = await db.rpc("replace_follow_up_rules", {
    p_campaign_id: id,
    p_rules: rules.map(normaliseRuleParams),
    p_max_follow_ups: max_follow_ups,
    p_min_gap_days: min_gap_days,
  });
  if (error) return apiError(500, "rules_update_failed", error.message);
  const campPatch: Record<string, unknown> = {};
  if (send_time_optimization !== undefined) campPatch.send_time_optimization = send_time_optimization;
  if (rules.length > 0) campPatch.follow_ups_enabled = true;
  if (Object.keys(campPatch).length) await db.from("campaigns").update(campPatch).eq("id", id).eq("user_id", userId);
  return NextResponse.json({ rules: await loadRules(db, id), recipients_rechecked: rechecked ?? 0 });
});
