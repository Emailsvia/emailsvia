import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { parseBooking, recordMeetingBooked } from "@/lib/meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Booking webhooks from the user's scheduler. The URL token (Settings →
// Meeting bookings) identifies the user; there's no end-user session, hence
// the service-role client, scoped by that user id everywhere below.
// Always 2xx for well-formed calls so schedulers don't disable the hook.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^mt_[A-Za-z0-9_-]{20,80}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = supabaseAdmin();
  const { data: owner } = await db
    .from("user_settings")
    .select("user_id")
    .eq("meetings_token", token)
    .maybeSingle();
  if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const text = await req.text();
  if (text.length > 200_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const booking = parseBooking(body);
  if ("ignored" in booking) return NextResponse.json({ ok: true, ignored: booking.ignored });
  const matched = await recordMeetingBooked(db, owner.user_id, booking);
  return NextResponse.json({ ok: true, matched });
}
