"use client";

import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import IntentBadge, { intentTone, type Intent } from "@/components/app/IntentBadge";

export type ReplyIntent =
  | "interested"
  | "not_now"
  | "question"
  | "unsubscribe"
  | "ooo"
  | "bounce"
  | "wrong_person"
  | "left_company"
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
  intent_source?: "ai" | "manual" | null;
  is_auto_reply?: boolean;
  read_at?: string | null;
  handled_at?: string | null;
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

type SentMessage = { id: string; subject: string; body: string; sent_at: string };

const LABEL_OPTIONS: ReplyIntent[] = ["interested", "question", "not_now", "unsubscribe", "wrong_person", "left_company", "ooo", "bounce", "other"];

const ACTION_NOTE: Record<string, string> = {
  unsubscribed: "Unsubscribed from all your campaigns.",
  bounced: "Marked bounced and added to your do-not-contact list.",
  sequence_resumed_after_ooo: "Out-of-office: their follow-ups resume in a week.",
  owner_notified: "We emailed you about this one.",
};

export default function ReplyDrawer({
  reply,
  onClose,
  onChanged,
}: {
  reply: ReplyItem | null;
  onClose: () => void;
  // Called after anything that changes how the reply lists (read, done,
  // label, answered) so the page can refresh.
  onChanged?: () => void;
}) {
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "send" | "ai" | "done" | "label">(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [intent, setIntent] = useState<ReplyIntent | null>(null);
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (!reply) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [reply, onClose]);

  useEffect(() => {
    if (!reply) return;
    setSent([]);
    setNote(null);
    setIntent(reply.intent);
    setHandled(!!reply.handled_at);
    setDraft("");
    let cancel = false;
    // Loading the detail also marks it read server-side.
    fetch(`/api/replies/${reply.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancel) return;
        setSent(d.sent ?? []);
        if (d.reply?.ai_draft) setDraft(d.reply.ai_draft);
        if (!reply.read_at) onChanged?.();
      })
      .catch(() => {});
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply?.id]);

  if (!reply) return null;

  async function patch(body: Record<string, unknown>) {
    const r = await fetch(`/api/replies/${reply!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? "Couldn't save.");
    return d as { actions?: string[] };
  }

  async function aiDraft() {
    setBusy("ai");
    setNote(null);
    try {
      const r = await fetch(`/api/replies/${reply!.id}/draft`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't draft a reply.");
      setDraft(d.draft);
      setNote({ tone: "ok", text: "Draft ready. Check any [bracketed] notes before sending." });
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (/\[[^\]]{3,80}\]/.test(draft) && !/\]\(https?:/.test(draft)) {
      if (!confirm("Your message still has a [bracketed] note. Send anyway?")) return;
    }
    setBusy("send");
    setNote(null);
    try {
      const r = await fetch(`/api/replies/${reply!.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Send failed.");
      setSent((prev) => [...prev, d.message]);
      setDraft("");
      setHandled(true);
      setNote({ tone: "ok", text: "Sent in the same thread. Marked done." });
      onChanged?.();
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleDone() {
    setBusy("done");
    try {
      await patch({ handled: !handled });
      setHandled(!handled);
      onChanged?.();
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function relabel(next: ReplyIntent) {
    if (next === intent) return;
    if (next === "unsubscribe" && !confirm("Label as unsubscribe? They'll be removed from all your campaigns.")) return;
    setBusy("label");
    setNote(null);
    try {
      const d = await patch({ intent: next });
      setIntent(next);
      const msgs = (d.actions ?? []).map((a) => ACTION_NOTE[a]).filter(Boolean);
      setNote({ tone: "ok", text: msgs.length ? msgs.join(" ") : "Label updated." });
      onChanged?.();
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const when = reply.received_at ?? reply.created_at;
  const whenFmt = new Date(when).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const senderName = reply.recipient?.name ?? reply.from_email;
  const initial = (senderName.trim()[0] || "?").toUpperCase();
  const tone = intentTone(intent as Intent | null);

  // Addresses mentioned in their message ("talk to jane@acme.com"), minus
  // their own: candidates to add as referred leads.
  const referrals = Array.from(
    new Set(
      ((reply.body_text ?? reply.snippet ?? "").split(/\n(?:On .{5,120}wrote:|>)/)[0].match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
        .map((e) => e.toLowerCase())
        .filter((e) => e !== reply.from_email.toLowerCase() && !/^(no-?reply|mailer-daemon|postmaster)@/.test(e))
    )
  ).slice(0, 3);

  async function addReferral(email: string) {
    setNote(null);
    const r = await fetch(`/api/replies/${reply!.id}/referral`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await r.json().catch(() => ({}));
    setNote(
      r.ok
        ? { tone: "ok", text: `Added ${email}${d.name ? ` (${d.name})` : ""} to this campaign.${d.reopened ? " The campaign was finished, so it's running again." : ""} Use {{Referred By}} in your template to mention who referred you.` }
        : { tone: "bad", text: d.error ?? "Couldn't add that lead." }
    );
  }

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
                  {intent && (
                    <IntentBadge
                      intent={intent as Intent}
                      confidence={intent === reply.intent ? reply.intent_confidence : null}
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

          {/* What we sent back from EmailsVia */}
          {sent.length > 0 && (
            <div className="mt-8 space-y-3">
              {sent.map((m) => (
                <div key={m.id} className="rounded-lg border border-ink-200 bg-surface px-4 py-3">
                  <div className="text-[11px] font-mono text-ink-500 mb-1.5">
                    You replied · {new Date(m.sent_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-[1.55] text-ink">{m.body}</pre>
                </div>
              ))}
            </div>
          )}

          {referrals.length > 0 && reply.campaign && (
            <div className="mt-6 rounded-lg border border-ink-200 px-4 py-3 text-[12.5px]">
              <div className="text-ink-600 mb-2">They mentioned someone else. Add them as a lead in this campaign?</div>
              <div className="flex flex-wrap gap-2">
                {referrals.map((e) => (
                  <button key={e} type="button" className="btn-ghost text-[12px]" onClick={() => addReferral(e)}>
                    + {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Triage controls */}
          <div className="mt-8 pt-5 border-t border-ink-100 flex items-center gap-2 flex-wrap">
            <label className="text-[12px] text-ink-500" htmlFor="reply-label">Label</label>
            <select
              id="reply-label"
              className="field-boxed text-[12.5px] py-1"
              value={intent ?? ""}
              disabled={busy !== null}
              onChange={(e) => relabel(e.target.value as ReplyIntent)}
            >
              {!intent && <option value="">Unlabelled</option>}
              {LABEL_OPTIONS.map((i) => (
                <option key={i} value={i}>{intentTone(i).label}</option>
              ))}
            </select>
            <button type="button" className="btn-quiet text-[12.5px] ml-auto" disabled={busy !== null} onClick={toggleDone}>
              {handled ? "Move back to inbox" : "Mark done"}
            </button>
          </div>

          {/* Composer */}
          <div className="mt-4">
            <textarea
              className="field-boxed w-full min-h-[140px] text-[13.5px] leading-[1.55]"
              placeholder={`Reply to ${senderName}…`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy === "send"}
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button type="button" className="btn-ghost text-[13px]" onClick={aiDraft} disabled={busy !== null}>
                {busy === "ai" ? "Drafting…" : draft ? "Redraft with AI" : "Draft with AI"}
              </button>
              <span className="text-[11.5px] text-ink-500 hidden sm:inline">
                Sends from the same inbox, in the same thread.
              </span>
              <button
                type="button"
                className="btn-accent text-[13px] ml-auto"
                onClick={send}
                disabled={busy !== null || !draft.trim()}
              >
                {busy === "send" ? "Sending…" : "Send reply"}
              </button>
            </div>
            {note && (
              <p className="text-[12.5px] mt-2" style={{ color: note.tone === "ok" ? "rgb(110 231 183)" : "rgb(252 165 165)" }}>
                {note.text}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
