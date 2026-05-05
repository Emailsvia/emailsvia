import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();

  const { data: source } = await db.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (!source) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const {
    id: _id,
    created_at: _ca,
    updated_at: _ua,
    status: _st,
    attachment_path: _ap,
    attachment_filename: _af,
    start_at: _sa,
    known_vars: _kv,
    ...rest
  } = source;

  const { data: dup, error } = await db
    .from("campaigns")
    .insert({
      ...rest,
      user_id: u.id,
      name: `${source.name} (copy)`,
      status: "draft",
      attachment_path: null,
      attachment_filename: null,
      start_at: null,
      known_vars: [],
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // copy follow-up steps
  const { data: steps } = await db.from("follow_up_steps").select("*").eq("campaign_id", id);
  if (steps && steps.length > 0) {
    const cloneSteps = steps.map((s) => ({
      campaign_id: dup.id,
      user_id: u.id,
      step_number: s.step_number,
      delay_days: s.delay_days,
      subject: s.subject,
      template: s.template,
    }));
    await db.from("follow_up_steps").insert(cloneSteps);
  }

  return NextResponse.json({ campaign: dup });
}
