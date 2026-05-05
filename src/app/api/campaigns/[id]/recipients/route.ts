import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { parseXlsx } from "@/lib/xlsx";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const buf = await file.arrayBuffer();

  let parsed;
  try {
    parsed = parseXlsx(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `parse_failed: ${msg}` }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "no_valid_rows", errors: parsed.errors }, { status: 400 });
  }

  const db = await supabaseUser();
  const rows = parsed.rows.map((r) => ({
    campaign_id: id,
    user_id: u.id,
    name: r.name,
    company: r.company,
    email: r.email,
    vars: r.vars,
    row_index: r.row_index,
  }));

  // Upsert with ON CONFLICT UPDATE — only the columns present in the payload
  // are updated (name / company / vars / row_index), so re-uploading a sheet
  // with fixed names updates them WITHOUT overwriting status / sent_at / tracking.
  const { data, error } = await db
    .from("recipients")
    .upsert(rows, { onConflict: "campaign_id,email" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (parsed.columns.length > 0) {
    await db.from("campaigns").update({ known_vars: parsed.columns }).eq("id", id);
  }

  return NextResponse.json({
    affected: data?.length ?? 0,
    total_valid: parsed.rows.length,
    columns: parsed.columns,
    parse_errors: parsed.errors,
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = await supabaseUser();
  const { error } = await db.from("recipients").delete().eq("campaign_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
