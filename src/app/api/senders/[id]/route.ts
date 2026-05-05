import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  from_name: z.string().max(200).optional().nullable(),
  is_default: z.boolean().optional(),
  warmup_enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  const db = await supabaseUser();
  if (parsed.data.is_default) {
    await db.from("senders").update({ is_default: false }).eq("is_default", true);
  }
  // If toggling warmup on for the first time, stamp the start date
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.warmup_enabled === true) {
    const { data: existing } = await db
      .from("senders")
      .select("warmup_started_at")
      .eq("id", id)
      .maybeSingle();
    if (!existing?.warmup_started_at) update.warmup_started_at = new Date().toISOString();
  }
  const { data, error } = await db
    .from("senders")
    .update(update)
    .eq("id", id)
    .select("id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sender: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { error } = await db.from("senders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
