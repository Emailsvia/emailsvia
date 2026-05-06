import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  variant_id: z.string().min(1).nullable(),
});

// Pin (or clear) the A/B winner. Once pinned, every new send goes to the
// winning variant — already-sent recipients keep the variant they got.
// Pass {variant_id: null} to clear and resume random pick.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const db = await supabaseUser();
  const { error } = await db
    .from("campaigns")
    .update({ ab_winner_id: parsed.data.variant_id })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ab_winner_id: parsed.data.variant_id });
}
