import { NextRequest, NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One recipient's full activity history (recipient_events), newest first,
// plus their current state and engagement rollup. Paginated with an
// opaque cursor: ?before=<cursor from next_before>&limit=50.

const RECIPIENT_COLS = [
  "id", "name", "email", "company", "status", "stop_reason", "error", "created_at",
  "sent_at", "replied_at", "last_sent_at", "next_follow_up_at", "next_step_number", "follow_up_count",
  "open_count", "machine_open_count", "first_opened_at", "last_opened_at",
  "click_count", "machine_click_count", "first_clicked_at", "last_clicked_at", "clicked_link_keys",
  "last_activity_at", "last_activity_type", "ooo_until",
].join(", ");

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, rid } = await ctx.params;
  const db = await supabaseUser();

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 200);
  const cursor = parseCursor(req.nextUrl.searchParams.get("before"));

  const { data: recipient } = await db
    .from("recipients")
    .select(RECIPIENT_COLS)
    .eq("id", rid)
    .eq("campaign_id", id)
    .maybeSingle();
  if (!recipient) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let q = db
    .from("recipient_events")
    .select("id, type, occurred_at, step_number, send_log_id, is_machine, machine_reason, data")
    .eq("recipient_id", rid)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    q = q.or(`occurred_at.lt.${cursor.at},and(occurred_at.eq.${cursor.at},id.lt.${cursor.id})`);
  }
  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const events = (rows ?? []).slice(0, limit);
  const last = events[events.length - 1];
  const next_before = (rows?.length ?? 0) > limit && last ? `${last.occurred_at}|${last.id}` : null;

  return NextResponse.json({ recipient, events, next_before });
}

function parseCursor(raw: string | null): { at: string; id: string } | null {
  if (!raw) return null;
  const [at, cid] = raw.split("|");
  if (!at || !cid || isNaN(Date.parse(at))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(cid)) return null;
  // Keep the DB's own timestamp text (microseconds); only allow timestamp
  // characters so it can't break out of the PostgREST filter.
  if (!/^[0-9T:.+\- Z]+$/i.test(at)) return null;
  return { at: at.replace(" ", "+"), id: cid };
}
