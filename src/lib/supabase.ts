import { createClient } from "@supabase/supabase-js";

// Service-role client. Bypasses RLS. Reserve for cron paths (/api/tick,
// /api/check-replies), tracking pixel, unsubscribe handler, and OAuth
// callbacks where there's no end-user JWT.
//
// The user-scoped client (supabaseUser) lives in supabase-server.ts because
// it pulls in next/headers, which can't be imported by client components.
// This file is import-safe from anywhere because it only re-exports types
// + the admin factory, both of which never run client-side.
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DaySchedule = { enabled: boolean; start: string; end: string };
export type Schedule = Record<WeekdayKey, DaySchedule>;

export type Sender = {
  id: string;
  label: string;
  email: string;
  app_password: string;
  from_name: string | null;
  is_default: boolean;
  created_at: string;
};

export type Campaign = {
  id: string;
  name: string;
  subject: string;
  template: string;
  from_name: string | null;
  status: "draft" | "running" | "paused" | "done";
  daily_cap: number;
  gap_seconds: number;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  sender_id: string | null;
  schedule: Schedule | null;
  follow_ups_enabled: boolean;
  retry_enabled: boolean;
  max_retries: number;
  attachment_path: string | null;
  attachment_filename: string | null;
  attachment_paths: string[];
  attachment_filenames: string[];
  tracking_enabled: boolean;
  unsubscribe_enabled: boolean;
  start_at: string | null;
  known_vars: string[];
  created_at: string;
  updated_at: string;
};

export const DEFAULT_SCHEDULE: Schedule = {
  mon: { enabled: true, start: "08:00", end: "18:00" },
  tue: { enabled: true, start: "08:00", end: "18:00" },
  wed: { enabled: true, start: "08:00", end: "18:00" },
  thu: { enabled: true, start: "08:00", end: "18:00" },
  fri: { enabled: true, start: "08:00", end: "18:00" },
  sat: { enabled: false, start: "09:00", end: "17:00" },
  sun: { enabled: false, start: "09:00", end: "17:00" },
};

export type Recipient = {
  id: string;
  campaign_id: string;
  name: string;
  company: string;
  email: string;
  domain: string | null;
  message_id: string | null;
  vars: Record<string, string>;
  status: "pending" | "sent" | "failed" | "skipped" | "replied" | "unsubscribed" | "bounced";
  sent_at: string | null;
  last_sent_at: string | null;
  follow_up_count: number;
  next_follow_up_at: string | null;
  replied_at: string | null;
  retry_count: number;
  next_retry_at: string | null;
  error: string | null;
  row_index: number;
  created_at: string;
};

export type FollowUpStep = {
  id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  subject: string | null;
  template: string;
  created_at: string;
};
