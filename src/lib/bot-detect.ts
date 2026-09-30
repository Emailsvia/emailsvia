// Tells human opens/clicks apart from machine traffic, so behaviour-based
// follow-ups and stats don't fire on robots. Machine events are still
// recorded (flagged), just never counted as engagement.
//
//   apple_mpp      Apple Mail Privacy Protection fetches every image on
//                  delivery through Apple's proxy (bare "Mozilla/5.0" UA,
//                  17.0.0.0/8). We can't tell whether the person read it.
//   prefetch       an open within seconds of sending: a mailbox provider or
//                  gateway fetching images, not a person.
//   scanner        link scanners and preview bots (Safe Links, Mimecast,
//                  Proofpoint, Barracuda, Slack/LinkedIn unfurls, scripts).
//   too_fast       a click within seconds of sending (scanners follow every
//                  link as the message arrives).
//   link_burst     several different links from the same email clicked
//                  within seconds: a scanner walking the message.
//   no_user_agent  real mail clients always send one.
//
// The SQL twin used by the migration 0025 backfill is
// emailsvia_machine_reason(); keep the UA pattern in step with it.

export type MachineReason =
  | "apple_mpp"
  | "prefetch"
  | "scanner"
  | "too_fast"
  | "link_burst"
  | "no_user_agent";

const SCANNER_UA =
  /(bot\b|crawler|spider|headless|scanner|barracuda|mimecast|proofpoint|safelinks|symantec|forcepoint|trend ?micro|sophos|bitdefender|fortinet|fortiguard|ironport|zscaler|python-|go-http-client|curl\/|wget|okhttp|axios|node-fetch|java\/|libwww|facebookexternalhit|slackbot|linkedinbot|twitterbot|whatsapp|skypeuripreview|discordbot|telegrambot|bingpreview)/i;

const OPEN_PREFETCH_SECONDS = 20;
const CLICK_TOO_FAST_SECONDS = 30;

// First address in X-Forwarded-For (set by Vercel / the proxy in front of us).
// Used only to classify the request; never stored.
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return headers.get("x-real-ip");
}

function uaReason(ua: string | null, ip: string | null): MachineReason | null {
  if (!ua || !ua.trim()) return "no_user_agent";
  if (ua.trim() === "Mozilla/5.0") return "apple_mpp";
  if (ip && /^17\./.test(ip)) return "apple_mpp";
  if (SCANNER_UA.test(ua)) return "scanner";
  return null;
}

function secondsSince(sentAt: Date | null, now: Date): number | null {
  if (!sentAt) return null;
  return (now.getTime() - sentAt.getTime()) / 1000;
}

export function classifyOpen(args: {
  userAgent: string | null;
  ip: string | null;
  sentAt: Date | null;
  now: Date;
}): MachineReason | null {
  const byUa = uaReason(args.userAgent, args.ip);
  if (byUa) return byUa;
  const s = secondsSince(args.sentAt, args.now);
  if (s !== null && s >= 0 && s < OPEN_PREFETCH_SECONDS) return "prefetch";
  return null;
}

export function classifyClick(args: {
  userAgent: string | null;
  ip: string | null;
  sentAt: Date | null;
  now: Date;
  // Another, different link from the same email was hit moments ago.
  otherLinkJustClicked: boolean;
}): MachineReason | null {
  const byUa = uaReason(args.userAgent, args.ip);
  if (byUa) return byUa;
  const s = secondsSince(args.sentAt, args.now);
  if (s !== null && s >= 0 && s < CLICK_TOO_FAST_SECONDS) return "too_fast";
  if (args.otherLinkJustClicked) return "link_burst";
  return null;
}

export const MACHINE_REASON_LABEL: Record<MachineReason, string> = {
  apple_mpp: "Apple Mail privacy proxy",
  prefetch: "Fetched automatically on delivery",
  scanner: "Security scanner or link preview",
  too_fast: "Clicked seconds after delivery (scanner)",
  link_burst: "Several links hit at once (scanner)",
  no_user_agent: "No browser information",
};
