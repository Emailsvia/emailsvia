"use client";

import { useEffect } from "react";
import DOMPurify from "isomorphic-dompurify";
import IntentBadge, { intentTone, type Intent } from "@/components/app/IntentBadge";

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

  const senderName = reply.recipient?.name ?? reply.from_email;
  const initial = (senderName.trim()[0] || "?").toUpperCase();
  const tone = intentTone(reply.intent as Intent | null);

  return (
    <div className="fixed inset-0 z-40">
      {/* Scrim — explicit dismiss target */}
      <button
        type="button"
        aria-label="Close reply"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm cursor-default"
      />

      <aside
        className="absolute top-0 right-0 bottom-0 w-full max-w-2xl bg-paper border-l border-ink-200 overflow-y-auto"
        style={{ boxShadow: "-30px 0 80px -20px rgb(0 0 0 / 0.45)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header with glass backdrop */}
        <header
          className="sticky top-0 z-10 px-5 sm:px-6 py-4 border-b border-ink-200"
          style={{
            background: "rgb(var(--c-paper) / 0.85)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span
                className="grid place-items-center w-10 h-10 rounded-full font-mono text-[14px] font-semibold shrink-0"
                style={{ background: tone.bg, color: tone.text }}
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">Reply</div>
                <h2 className="text-[17px] font-semibold tracking-[-0.01em] mt-0.5 text-ink truncate">
                  {reply.subject || <span className="italic text-ink-400 font-normal">(no subject)</span>}
                </h2>
                <div className="flex items-center gap-2 text-[13px] text-ink-700 mt-1 flex-wrap">
                  <span className="font-medium">{senderName}</span>
                  {reply.recipient?.company && (
                    <span className="text-ink-500">· {reply.recipient.company}</span>
                  )}
                  {reply.intent && (
                    <IntentBadge
                      intent={reply.intent as Intent}
                      confidence={reply.intent_confidence}
                      size="xs"
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[11.5px] font-mono text-ink-500 truncate">{reply.from_email}</span>
                  <span className="text-ink-300">·</span>
                  <span className="text-[11.5px] font-mono text-ink-500">{whenFmt}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="grid place-items-center w-8 h-8 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer shrink-0"
              aria-label="Close"
              title="Close (Esc)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="px-5 sm:px-6 py-6">
          {reply.body_html ? (
            <div
              className="email-preview text-ink text-[14px] leading-[1.6]"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.body_html) }}
            />
          ) : reply.body_text ? (
            <pre className="whitespace-pre-wrap font-sans text-[14px] leading-[1.6] text-ink">
              {reply.body_text}
            </pre>
          ) : reply.snippet ? (
            <div className="text-[14px] text-ink-700 leading-[1.6]">{reply.snippet}</div>
          ) : (
            <div className="text-[13px] text-ink-500 italic">
              No body captured for this message.
            </div>
          )}

          {/* Quick reply hint */}
          <div className="mt-8 pt-5 border-t border-ink-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] text-ink-500">
              Reply lives in your Gmail thread — open there to respond.
            </div>
            <a
              href={`mailto:${reply.from_email}${reply.subject ? `?subject=${encodeURIComponent("Re: " + reply.subject)}` : ""}`}
              className="btn-ghost text-[13px]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
              </svg>
              Reply in mail client
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
