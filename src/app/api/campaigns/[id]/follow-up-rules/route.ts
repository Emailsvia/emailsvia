import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { getPlan, hasFeature } from "@/lib/billing";
import { loadRules, normaliseRuleParams, SaveRulesSchema } from "@/lib/followup-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Activity-based follow-up rules for a campaign ("when they didn't open /
// clicked / … send these emails"), plus the campaign-wide guardrails.
// The campaign's plain step list stays at /follow-ups.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data: camp } = await db
    .from("campaigns")
    .select("max_follow_ups, min_gap_days, send_time_optimization")
    .eq("id", id)
    .maybeSingle();
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rules = await loadRules(db, id);
  return NextResponse.json({
    rules,
    max_follow_ups: camp.max_follow_ups ?? 5,
    min_gap_days: Number(camp.min_gap_days ?? 2),
    send_time_optimization: !!camp.send_time_optimization,
  });
}

// Replace all rules at once (one transaction; ids kept so each person's
// progress through a rule survives edits).
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = SaveRulesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const db = await supabaseUser();
  const { data: camp } = await db.from("campaigns").select("id").eq("id", id).maybeSingle();
  if (!camp) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { rules, max_follow_ups, min_gap_days, send_time_optimization } = parsed.data;
  if (rules.length > 0 || send_time_optimization) {
    const plan = await getPlan(db, u.id);
    if (!hasFeature(plan, "follow_ups") || !hasFeature(plan, "conditional_sequences")) {
      return NextResponse.json(
        { error: "Follow-ups based on what people did (opens, clicks…) are available on Growth and Scale." },
        { status: 402 }
      );
    }
  }
  const { data: flagged, error } = await db.rpc("replace_follow_up_rules", {
    p_campaign_id: id,
    p_rules: rules.map(normaliseRuleParams),
    p_max_follow_ups: max_follow_ups,
    p_min_gap_days: min_gap_days,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (send_time_optimization !== undefined) {
    await db.from("campaigns").update({ send_time_optimization }).eq("id", id);
  }
  return NextResponse.json({
    rules: await loadRules(db, id),
    max_follow_ups,
    min_gap_days,
    recipients_rechecked: flagged ?? 0,
  });
}
