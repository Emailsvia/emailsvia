import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";
import { findSuppression } from "@/lib/sequence-stop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(200).optional(),
});

// "Not me, talk to jane@acme.com": add the referred person to the same
// campaign as a new pending recipient. Company and custom columns are
// copied from the person who replied (same company), the name is replaced,
// and "Referred By" is set so the template can say who pointed you there.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const { email } = parsed.data;

  const db = await supabaseUser();
  const { data: reply } = await db
    .from("replies")
    .select(`
      id, from_email, campaign_id,
      recipient:recipients(name, company, vars),
      campaign:campaigns(id, status)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!reply || !reply.campaign_id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const source = (Array.isArray(reply.recipient) ? reply.recipient[0] : reply.recipient) as {
    name: string | null; company: string | null; vars: Record<string, string> | null;
  } | null;
  const campaign = (Array.isArray(reply.campaign) ? reply.campaign[0] : reply.campaign) as { id: string; status: string } | null;

  if (email === reply.from_email.toLowerCase()) {
    return NextResponse.json({ error: "That's the person who replied." }, { status: 400 });
  }
  const [{ data: unsub }, suppressed] = await Promise.all([
    db.from("unsubscribes").select("email").eq("email", email).maybeSingle(),
    findSuppression(db, u.id, email),
  ]);
  if (unsub || suppressed) {
    return NextResponse.json({ error: `${email} is unsubscribed or on your do-not-contact list.` }, { status: 409 });
  }

  const name = parsed.data.name || nameFromEmail(email);
  const vars: Record<string, string> = { ...(source?.vars ?? {}) };
  for (const k of Object.keys(vars)) {
    if (/^(first ?name|name|full ?name|last ?name|email|e-mail)$/i.test(k)) delete vars[k];
  }
  vars.Name = name;
  vars["First Name"] = name.split(" ")[0];
  vars["Referred By"] = source?.name || reply.from_email;

  const { data: last } = await db
    .from("recipients")
    .select("row_index")
    .eq("campaign_id", reply.campaign_id)
    .order("row_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: inserted, error } = await db
    .from("recipients")
    .upsert(
      {
        campaign_id: reply.campaign_id,
        user_id: u.id,
        name,
        company: source?.company ?? "",
        email,
        vars,
        status: "pending",
        row_index: (last?.row_index ?? 0) + 1,
      },
      { onConflict: "campaign_id,email", ignoreDuplicates: true }
    )
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!inserted?.length) {
    return NextResponse.json({ error: `${email} is already in this campaign.` }, { status: 409 });
  }

  // A finished campaign has nothing left to send; reopen it so the new lead goes out.
  let reopened = false;
  if (campaign?.status === "done") {
    await db.from("campaigns").update({ status: "running" }).eq("id", campaign.id);
    reopened = true;
  }
  return NextResponse.json({ ok: true, name, reopened });
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (/^(info|sales|hello|contact|team|support|admin|office)$/i.test(local)) return "";
  const first = local.split(/[._-]/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}
