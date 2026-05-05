import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { verifyCredentials } from "@/lib/mail";
import { getUser } from "@/lib/auth-server";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  label: z.string().min(1, "Label is required").max(100),
  email: z.string().email("Invalid email").transform((v) => v.toLowerCase()),
  app_password: z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .length(16, "App password must be exactly 16 characters — that's the format Google generates. Not your Gmail login password.")
        .regex(/^[a-z]+$/i, "App password should be only letters (no digits, no special characters). Generate a new one at myaccount.google.com/apppasswords.")
    ),
  from_name: z.string().max(200).optional().nullable(),
  is_default: z.boolean().optional(),
  warmup_enabled: z.boolean().optional(),
});

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("senders")
    .select("id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, auth_method, oauth_status, created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ senders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { label, email, app_password, from_name, is_default, warmup_enabled } = parsed.data;

  // verify SMTP login works before saving
  const pw = app_password.replace(/\s+/g, "");
  const v = await verifyCredentials({ email, appPassword: pw });
  if (!v.ok) return NextResponse.json({ error: `smtp_verify_failed: ${v.error}` }, { status: 400 });

  const db = await supabaseUser();
  if (is_default) {
    await db.from("senders").update({ is_default: false }).eq("is_default", true);
  }
  const { data, error } = await db
    .from("senders")
    .insert({
      user_id: u.id,
      label,
      email,
      auth_method: "app_password",
      app_password: encryptSecret(pw),
      from_name: from_name ?? null,
      is_default: !!is_default,
      warmup_enabled: !!warmup_enabled,
      warmup_started_at: warmup_enabled ? new Date().toISOString() : null,
    })
    .select("id, label, email, from_name, is_default, warmup_enabled, warmup_started_at, auth_method, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sender: data });
}
