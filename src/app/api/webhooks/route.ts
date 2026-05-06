import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { generateWebhookSecret, isWebhookEvent } from "@/lib/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.string()).min(1).max(8),
});

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("webhooks")
    .select("id, name, url, events, active, last_used_at, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const events = parsed.data.events.filter(isWebhookEvent);
  if (events.length === 0) {
    return NextResponse.json({ error: "no_valid_events" }, { status: 400 });
  }

  // Reject http URLs in production — webhooks deliver user reply bodies,
  // which contain PII. Localhost is fine for testing.
  if (process.env.NODE_ENV === "production" && !parsed.data.url.startsWith("https://")) {
    return NextResponse.json({ error: "https_required" }, { status: 400 });
  }

  const secret = generateWebhookSecret();
  const db = await supabaseUser();
  const { data, error } = await db
    .from("webhooks")
    .insert({
      user_id: u.id,
      name: parsed.data.name,
      url: parsed.data.url,
      secret,
      events,
      active: true,
    })
    .select("id, name, url, events, active, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Single-use: secret is shown only here.
  return NextResponse.json({ webhook: data, secret });
}
