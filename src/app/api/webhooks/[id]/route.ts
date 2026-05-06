import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { isWebhookEvent } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
  events: z.array(z.string()).min(1).max(8).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (parsed.data.events !== undefined) {
    const events = parsed.data.events.filter(isWebhookEvent);
    if (events.length === 0) return NextResponse.json({ error: "no_valid_events" }, { status: 400 });
    update.events = events;
  }

  const db = await supabaseUser();
  const { error } = await db.from("webhooks").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { error } = await db.from("webhooks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
