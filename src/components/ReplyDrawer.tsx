"use client";

import { useEffect } from "react";
import DOMPurify from "isomorphic-dompurify";

export type ReplyIntent =
  | "interested"
  | "not_now"
  | "question"
  | "unsubscribe"
  | "ooo"
  | "bounce"
  | "other";

export type ReplyItem = {
  id: string;
  from_email: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  created_at: string;
  intent: ReplyIntent | null;
  intent_confidence: number | null;
  recipient: { id: string; name: string; company: string } | null;
  campaign: { id: string; name: string } | null;
};

// Inbound reply HTML comes from arbitrary senders — anyone with our
// recipient's address can craft a malicious reply. The previous regex-
// based sanitizer was bypassable (`<scr<script>ipt>` survived; unquoted
// `onclick=foo()` slipped through). isomorphic-dompurify uses jsdom
// server-side and the real DOMPurify in the browser; same allow-list
// in both environments.
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "form", "input", "button", "object", "embed", "link", "meta"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
    // Drop CSS expressions + javascript: URLs entirely; allow image
    // proxies and standard https/http/mailto/tel.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export default function ReplyDrawer({
  reply,
  onClose,
}: {
  reply: ReplyItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!reply) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [reply, onClose]);

  if (!reply) return null;

  const when = reply.received_at ?? reply.created_at;
  const whenFmt = new Date(when).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <aside
        className="absolute top-0 right-0 bottom-0 w-full max-w-2xl bg-paper border-l border-ink-200 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-paper border-b border-ink-200 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">Reply</div>
            <div className="text-[16px] font-semibold mt-0.5 truncate">
              {reply.subject || <span className="italic text-ink-400">(no subject)</span>}
            </div>
            <div className="flex items-center gap-2 text-[13px] text-ink-600 mt-1 flex-wrap">
              <span className="font-medium">{reply.recipient?.name ?? reply.from_email}</span>
              {reply.recipient?.company && <span className="text-ink-400">· {reply.recipient.company}</span>}
            </div>
            <div className="text-[11px] font-mono text-ink-500 truncate mt-0.5">{reply.from_email}</div>
            <div className="text-[11px] text-ink-500 mt-1">{whenFmt}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-quiet p-1.5 shrink-0" aria-label="Close">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>

        <div className="px-5 py-5">
          {reply.body_html ? (
            <div
              className="email-preview bg-paper text-ink text-[14px] leading-[1.55]"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.body_html) }}
            />
          ) : reply.body_text ? (
            <pre className="whitespace-pre-wrap font-sans text-[14px] leading-[1.55] text-ink">{reply.body_text}</pre>
          ) : reply.snippet ? (
            <div className="text-[14px] text-ink-700 leading-[1.55]">{reply.snippet}</div>
          ) : (
            <div className="text-[13px] text-ink-500">No body captured for this message.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
