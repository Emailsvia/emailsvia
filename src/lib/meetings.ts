import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEvents } from "./activity";
import { emitMeetingBooked, emitSequenceStopped } from "./events";
import { cancelPending } from "./nurture";
import { stopDomainAfterReply } from "./sequence-stop";

// Meeting bookings from the user's scheduler (Calendly, Cal.com, or anything
// that can POST JSON, e.g. Zapier/Make), via /api/inbound/meetings/<token>.
// A booking is the goal of the whole sequence: stop following up with that
// person everywhere, cancel anything scheduled, and log it.

export type Booking = {
  provider: "calendly" | "calcom" | "generic";
  emails: string[];
  name: string | null;
  start_time: string | null;
  event_name: string | null;
  booking_id: string | null;
};

// Conservative on purpose: these go into a PostgREST filter.
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// null = not a new booking (cancellation, ping, unknown shape).
export function parseBooking(body: unknown): Booking | { ignored: string } {
  if (!body || typeof body !== "object") return { ignored: "not_json_object" };
  const b = body as Record<string, any>;

  // Calendly webhook v2
  if (typeof b.event === "string" && b.payload && typeof b.payload === "object") {
    if (b.event !== "invitee.created") return { ignored: b.event };
    const p = b.payload;
    return {
      provider: "calendly",
      emails: [str(p.email)].filter((x): x is string => !!x),
      name: str(p.name),
      start_time: str(p.scheduled_event?.start_time),
      event_name: str(p.scheduled_event?.name),
      booking_id: str(p.uri) ?? str(p.scheduled_event?.uri),
    };
  }
  // Cal.com webhook
  if (typeof b.triggerEvent === "string") {
    if (b.triggerEvent !== "BOOKING_CREATED" && b.triggerEvent !== "BOOKING_RESCHEDULED") return { ignored: b.triggerEvent };
    const p = b.payload ?? {};
    const attendees = Array.isArray(p.attendees) ? p.attendees : [];
    return {
      provider: "calcom",
      emails: attendees.map((a: any) => str(a?.email)).filter((x: string | null): x is string => !!x),
      name: str(attendees[0]?.name),
      start_time: str(p.startTime),
      event_name: str(p.title) ?? str(p.eventTitle),
      booking_id: str(p.uid) ?? (p.bookingId != null ? String(p.bookingId) : null),
    };
  }
  // Generic: { email } or { emails: [] }, optional name/start_time/event_name/booking_id
  const emails = [str(b.email), ...(Array.isArray(b.emails) ? b.emails.map(str) : [])].filter((x): x is string => !!x);
  if (emails.length === 0) return { ignored: "no_email" };
  return {
    provider: "generic",
    emails,
    name: str(b.name),
    start_time: str(b.start_time),
    event_name: str(b.event_name),
    booking_id: str(b.booking_id),
  };
}

// Returns how many recipients (across the user's campaigns) it applied to.
export async function recordMeetingBooked(db: SupabaseClient, userId: string, booking: Booking): Promise<number> {
  const emails = Array.from(new Set(booking.emails.map((e) => e.toLowerCase()).filter((e) => EMAIL.test(e)))).slice(0, 10);
  if (emails.length === 0) return 0;
  const { data: rows } = await db
    .from("recipients")
    .select("id, email, campaign_id, user_id, status, follow_up_count, next_follow_up_at")
    .eq("user_id", userId)
    // Case-insensitive exact match (imports keep the original casing); escape
    // the ilike wildcards so j_doe@ can't match jxdoe@.
    .or(emails.map((e) => `email.ilike.${e.replace(/[\\%_]/g, (c) => `\\${c}`)}`).join(","))
    .in("status", ["pending", "sent", "replied"]);
  if (!rows?.length) return 0;

  const info = { provider: booking.provider, start_time: booking.start_time, event_name: booking.event_name, booking_id: booking.booking_id };
  await recordEvents(
    db,
    rows.map((r) => ({
      user_id: r.user_id,
      campaign_id: r.campaign_id,
      recipient_id: r.id,
      type: "meeting_booked" as const,
      data: info,
      dedupe_key: `meeting:${booking.booking_id ?? booking.start_time ?? "booked"}`,
    }))
  );

  for (const r of rows) {
    const rc = { id: r.id, email: r.email, campaign_id: r.campaign_id, user_id: r.user_id };
    if (r.status === "pending") {
      // Booked before we even emailed them (e.g. from another channel).
      await db.from("recipients").update({ status: "skipped", stop_reason: "meeting_booked", next_retry_at: null }).eq("id", r.id).eq("status", "pending");
    } else if (r.status === "sent") {
      await db.from("recipients").update({ next_follow_up_at: null, stop_reason: "meeting_booked", reeval_pending: false }).eq("id", r.id).eq("status", "sent");
      await emitSequenceStopped(db, rc, "meeting_booked", r.follow_up_count ?? 0);
    }
    await cancelPending(db, r.id, { reason: "meeting_booked" });
    await emitMeetingBooked(db, rc, info);
    // Someone at the company is talking to you now: same as a reply.
    const { data: camp } = await db.from("campaigns").select("stop_on_domain_reply").eq("id", r.campaign_id).maybeSingle();
    if (camp?.stop_on_domain_reply !== false) {
      await stopDomainAfterReply(db, r.campaign_id, { id: r.id, email: r.email });
    }
  }
  return rows.length;
}
