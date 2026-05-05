import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { generateApiKey } from "@/lib/api-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
});

// List the caller's API keys. Returns prefix + last_used_at only — never
// the raw token (which is unrecoverable after creation by design).
export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("api_keys")
    .select("id, name, prefix, last_used_at, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

// Create a new API key. The raw token is in the response — show once,
// never store. The UI must surface a "copy now, you won't see this again"
// confirmation step.
export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_name" }, { status: 400 });

  const generated = generateApiKey();
  const db = await supabaseUser();
  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: u.id,
      name: parsed.data.name,
      prefix: generated.prefix,
      key_hash: generated.hash,
    })
    .select("id, name, prefix, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    key: data,
    // Single-use: the user must copy this now. Never returned again.
    raw_token: generated.raw,
  });
}
