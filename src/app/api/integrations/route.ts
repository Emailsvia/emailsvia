import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { encryptSecret } from "@/lib/crypto";
import { getPlan, hasFeature } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["hubspot", "pipedrive", "slack"] as const;
const INTENTS = ["interested", "question", "not_now", "unsubscribe", "wrong_person", "other"] as const;

// GET: the caller's integrations, without secrets.
export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("integrations")
    .select("provider, push_intents, active, last_synced_at, last_error, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ integrations: data ?? [] });
}

const PutSchema = z.object({
  provider: z.enum(PROVIDERS),
  // Omit to keep the stored secret (e.g. only changing intents).
  secret: z.string().trim().min(8).max(500).optional(),
  push_intents: z.array(z.enum(INTENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

// PUT: connect or update one provider.
export async function PUT(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { provider, secret, push_intents, active } = parsed.data;

  const db = await supabaseUser();
  const plan = await getPlan(db, u.id);
  if (!hasFeature(plan, "webhooks")) {
    return NextResponse.json({ error: "Integrations are available on Growth and Scale." }, { status: 402 });
  }
  if (provider === "slack" && secret && !/^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(secret)) {
    return NextResponse.json({ error: "Paste a Slack incoming-webhook URL (https://hooks.slack.com/services/…)." }, { status: 400 });
  }

  const { data: existing } = await db.from("integrations").select("id").eq("provider", provider).maybeSingle();
  if (!existing && !secret) return NextResponse.json({ error: "Paste the token first." }, { status: 400 });

  const row: Record<string, unknown> = { user_id: u.id, provider };
  if (secret) {
    row.secret_encrypted = encryptSecret(secret);
    row.last_error = null;
  }
  if (push_intents) row.push_intents = push_intents;
  if (active !== undefined) row.active = active;

  const { error } = existing
    ? await db.from("integrations").update(row).eq("id", existing.id)
    : await db.from("integrations").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const provider = req.nextUrl.searchParams.get("provider");
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  const db = await supabaseUser();
  const { error } = await db.from("integrations").delete().eq("provider", provider!);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
