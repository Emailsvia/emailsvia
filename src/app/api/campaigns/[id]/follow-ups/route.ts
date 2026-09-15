import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { getPlan, hasFeature } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConditionSchema = z.union([
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("no_reply") }),
  z.object({ type: z.literal("intent_in"), intents: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("intent_not_in"), intents: z.array(z.string()).min(1) }),
]);

const StepSchema = z.object({
  // Existing step's id, so the server can remap recipients when steps are
  // deleted or renumbered. Omitted for new steps.
  id: z.string().uuid().optional(),
  step_number: z.number().int().min(1).max(10),
  delay_days: z.number().min(0.5).max(60),
  delay_unit: z.enum(["days", "business_days"]).optional(),
  subject: z.string().max(500).nullable().optional(),
  template: z.string().min(1),
  condition: ConditionSchema.nullable().optional(),
});

const ReplaceSchema = z.object({
  steps: z.array(StepSchema).max(10),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { data, error } = await db
    .from("follow_up_steps")
    .select("*")
    .eq("campaign_id", id)
    .order("step_number", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ steps: data ?? [] });
}

// Replace all steps for the campaign (simpler than per-step CRUD)
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = ReplaceSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const db = await supabaseUser();
  // Gate only when the campaign actually uses follow-ups, so a Free user
  // with leftover (disabled) steps can still save the rest of the campaign.
  // Tick enforces the same feature flag at send time regardless.
  const { data: camp } = await db
    .from("campaigns")
    .select("follow_ups_enabled")
    .eq("id", id)
    .maybeSingle();
  if (parsed.data.steps.length > 0 && camp?.follow_ups_enabled) {
    const plan = await getPlan(db, u.id);
    if (!hasFeature(plan, "follow_ups")) {
      return NextResponse.json(
        { error: "Follow-ups aren't included in your plan. Upgrade to add follow-up steps." },
        { status: 402 }
      );
    }
    const usesConditions = parsed.data.steps.some((s) => s.condition && s.condition.type !== "always");
    if (usesConditions && !hasFeature(plan, "conditional_sequences")) {
      return NextResponse.json(
        { error: "Conditional follow-up steps are available on Growth and Scale." },
        { status: 402 }
      );
    }
  }
  // Recipients point at steps by number (next_step_number); tick walks
  // forward to the next existing step, so removing a step doesn't strand
  // them. Delete + insert happen in one transaction so a concurrent tick
  // never sees an empty sequence.
  const rows = parsed.data.steps.map((s) => ({
    id: s.id ?? null,
    step_number: s.step_number,
    delay_days: s.delay_days,
    delay_unit: s.delay_unit ?? "days",
    subject: s.subject ?? null,
    template: s.template,
    condition: s.condition ?? null,
  }));
  const { data, error } = await db.rpc("replace_follow_up_steps", {
    p_campaign_id: id,
    p_steps: rows,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (rows.length === 0) return NextResponse.json({ steps: [] });
  if (camp?.follow_ups_enabled) {
    await db.rpc("backfill_follow_ups", { p_campaign_id: id });
  }
  return NextResponse.json({ steps: data ?? [] });
}
