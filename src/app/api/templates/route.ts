import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { TemplateSchema } from "@/lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The user's reusable email templates. Using one in a campaign copies it,
// so editing the library never changes a running campaign.

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("email_templates")
    .select("id, name, subject, body, situations, source, original_filename, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = TemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("email_templates")
    .insert({
      user_id: u.id,
      name: parsed.data.name,
      subject: parsed.data.subject?.trim() || null,
      body: parsed.data.body,
      situations: parsed.data.situations ?? [],
      source: parsed.data.source ?? "written",
      original_filename: parsed.data.original_filename ?? null,
    })
    .select("id, name, subject, body, situations, source, original_filename, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
