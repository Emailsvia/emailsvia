import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { decryptSecret } from "@/lib/crypto";
import { pushToProvider, type IntegrationProvider } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST {provider}: push a sample "interested" reply so the user can see it
// land in HubSpot / Pipedrive / Slack. Uses a fake example.com prospect.
export async function POST(req: NextRequest) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { provider } = (await req.json().catch(() => ({}))) as { provider?: string };
  const db = await supabaseUser();
  const { data: row } = await db
    .from("integrations")
    .select("id, provider, secret_encrypted")
    .eq("provider", provider ?? "")
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Connect it first." }, { status: 404 });
  try {
    await pushToProvider(row.provider as IntegrationProvider, decryptSecret(row.secret_encrypted), {
      id: "test",
      user_id: u.id,
      intent: "interested",
      from_email: "test.prospect@example.com",
      subject: "Re: Quick question (EmailsVia test)",
      snippet: null,
      body_text: "Sounds interesting. Can you send over some times next week? (This is a test from EmailsVia.)",
      received_at: new Date().toISOString(),
      prospect_name: "Test Prospect",
      company: "Example Co",
      campaign_name: "EmailsVia connection test",
    });
    await db.from("integrations").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", row.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("integrations").update({ last_error: msg.slice(0, 500) }).eq("id", row.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
