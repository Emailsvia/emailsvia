import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadUserSettings } from "@/lib/user-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = await loadUserSettings(u.id);
  return NextResponse.json(s);
}

export async function PATCH(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, boolean> = {};
  if (typeof (body as { tracking_enabled_default?: unknown })?.tracking_enabled_default === "boolean") {
    patch.tracking_enabled_default = (body as { tracking_enabled_default: boolean }).tracking_enabled_default;
  }
  if (typeof (body as { poll_replies?: unknown })?.poll_replies === "boolean") {
    patch.poll_replies = (body as { poll_replies: boolean }).poll_replies;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_valid_fields" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("user_settings")
    .upsert({ user_id: u.id, ...patch }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const s = await loadUserSettings(u.id);
  return NextResponse.json(s);
}
