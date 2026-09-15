import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user do-not-contact list. Tick checks it before every send, across
// all campaigns. Bounces add themselves; users add addresses or whole
// domains (existing customers, competitors, "never email us" requests).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

const AddSchema = z.object({
  // One entry per line/comma; each is an email or a bare domain (@ optional).
  entries: z.string().min(1).max(50_000),
});

function parseEntry(raw: string): { kind: "email" | "domain"; value: string } | null {
  const v = raw.trim().toLowerCase().replace(/^@/, "");
  if (!v) return null;
  if (v.includes("@")) return EMAIL_RE.test(v) ? { kind: "email", value: v } : null;
  return DOMAIN_RE.test(v) ? { kind: "domain", value: v } : null;
}

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await supabaseUser();
  const { data, error } = await db
    .from("suppressions")
    .select("kind, value, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppressions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = AddSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "entries required" }, { status: 400 });

  const valid = new Map<string, { kind: "email" | "domain"; value: string }>();
  const invalid: string[] = [];
  for (const raw of parsed.data.entries.split(/[\n,;]+/)) {
    if (!raw.trim()) continue;
    const e = parseEntry(raw);
    if (e) valid.set(`${e.kind}:${e.value}`, e);
    else invalid.push(raw.trim());
  }
  if (valid.size === 0) {
    return NextResponse.json({ error: "No valid emails or domains found.", invalid }, { status: 400 });
  }
  if (valid.size > 5000) {
    return NextResponse.json({ error: "Add at most 5,000 entries at a time." }, { status: 400 });
  }
  const db = await supabaseUser();
  const rows = Array.from(valid.values()).map((e) => ({ ...e, user_id: u.id, reason: "manual" }));
  const { error } = await db
    .from("suppressions")
    .upsert(rows, { onConflict: "user_id,kind,value", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ added: rows.length, invalid: invalid.slice(0, 50) });
}

export async function DELETE(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind");
  const value = req.nextUrl.searchParams.get("value")?.toLowerCase();
  if ((kind !== "email" && kind !== "domain") || !value) {
    return NextResponse.json({ error: "kind and value required" }, { status: 400 });
  }
  const db = await supabaseUser();
  const { error } = await db.from("suppressions").delete().eq("kind", kind).eq("value", value);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
