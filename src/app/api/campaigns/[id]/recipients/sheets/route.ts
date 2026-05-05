import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { parseSheet } from "@/lib/sheets";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  url: z.string().url(),
  sheet_name: z.string().min(1),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 });

  let rows, errors, columns;
  try {
    const out = await parseSheet(parsed.data.url, parsed.data.sheet_name);
    rows = out.rows;
    errors = out.errors;
    columns = out.columns;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "no_valid_rows", errors }, { status: 400 });
  }

  const db = await supabaseUser();
  const payload = rows.map((r) => ({
    campaign_id: id,
    user_id: u.id,
    name: r.name,
    company: r.company,
    email: r.email,
    vars: r.vars,
    row_index: r.row_index,
  }));
  const { data, error } = await db
    .from("recipients")
    .upsert(payload, { onConflict: "campaign_id,email" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (columns.length > 0) {
    await db.from("campaigns").update({ known_vars: columns }).eq("id", id);
  }

  return NextResponse.json({
    inserted: data?.length ?? 0,
    total_valid: rows.length,
    columns,
    parse_errors: errors,
  });
}
