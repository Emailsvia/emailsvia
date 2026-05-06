"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import EmptyState from "@/components/app/EmptyState";
import IntentBadge, { INTENT_ORDER, intentTone, type Intent } from "@/components/app/IntentBadge";
import ReplyDrawer, { type ReplyItem } from "@/components/ReplyDrawer";

export default function RepliesPage() {
  const [replies, setReplies] = useState<ReplyItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<ReplyItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [intentFilter, setIntentFilter] = useState<Intent | "all">("all");

  async function load() {
    const r = await fetch("/api/replies", { cache: "no-store" });
    const d = await r.json();
    setReplies(d.replies ?? []);
  }

  useEffect(() => { load(); }, []);

  async function reload() {
    setRunning(true);
    await load();
    setRunning(false);
  }

  async function deleteReply(id: string) {
    if (!confirm("Delete this reply? This only removes it from the list — the recipient stays marked as replied.")) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/replies/${id}`, { method: "DELETE" });
      if (!r.ok) {
        alert("Failed to delete reply.");
        return;
      }
      setReplies((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
      if (active?.id === id) setActive(null);
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!replies) return null;
    const q = query.trim().toLowerCase();
    return replies.filter((r) => {
      if (intentFilter !== "all") {
        const slot = (r.intent ?? "uncategorized") as Intent;
        if (slot !== intentFilter) return false;
      }
      if (!q) return true;
      const hay = [
        r.recipient?.name,
        r.recipient?.company,
        r.from_email,
        r.subject,
        r.snippet,
        r.campaign?.name,
      ]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join("  ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [replies, query, intentFilter]);

  const intentCounts = useMemo(() => {
    const counts: Record<Intent, number> = {
      interested: 0, question: 0, not_now: 0, unsubscribe: 0,
      ooo: 0, bounce: 0, other: 0, uncategorized: 0,
    };
    for (const r of replies ?? []) {
      const slot = (r.intent ?? "uncategorized") as Intent;
      counts[slot]++;
    }
    return counts;
  }, [replies]);

  const totalCount = replies?.length ?? 0;
  const filteredCount = filtered?.length ?? 0;
  const isFiltering = query.trim().length > 0 || intentFilter !== "all";

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          eyebrow="Workspace"
          title="Replies"
          subtitle={
            replies === null
              ? "Loading…"
              : isFiltering
                ? `${filteredCount} of ${totalCount} inbound — refine or reset filters above`
                : `${totalCount} inbound message${totalCount === 1 ? "" : "s"} from recipients across all campaigns`
          }
          actions={
            <button
              type="button"
              onClick={reload}
              disabled={running}
              className="btn-ghost text-[13px]"
            >
              {running ? (
                <>
                  <Spinner /> Refreshing
                </>
              ) : (
                <>
                  <RefreshIcon /> Reload
                </>
              )}
            </button>
          }
        />

        {/* Intent chip row */}
        {replies && replies.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5 flex-wrap">
            <IntentChip
              label="All"
              count={totalCount}
              active={intentFilter === "all"}
              onClick={() => setIntentFilter("all")}
            />
            {INTENT_ORDER.map((slot) => {
              const n = intentCounts[slot];
              if (n === 0) return null;
              const tone = intentTone(slot);
              const active = intentFilter === slot;
              return (
                <IntentChip
                  key={slot}
                  label={tone.label}
                  count={n}
                  dot={tone.dot}
                  textColor={tone.text}
                  bg={tone.bg}
                  active={active}
                  onClick={() => setIntentFilter(active ? "all" : slot)}
                />
              );
            })}
          </div>
        )}

        {/* Search */}
        {replies && replies.length > 0 && (
          <div className="mb-4 relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, company, subject, or campaign…"
              className="w-full bg-surface border border-ink-200 rounded-lg pl-9 pr-9 py-2 text-[13.5px] text-ink placeholder:text-ink-400 outline-none focus:border-ink-300 transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded text-ink-500 hover:bg-hover hover:text-ink transition-colors cursor-pointer"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M3 3l6 6M3 9l6-6" />
                </svg>
              </button>
            )}
          </div>
        )}

        {replies === null && <SkeletonReplies />}

        {replies?.length === 0 && (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
              </svg>
            }
            title="No replies yet"
            body="Inbound replies show up here within five minutes of landing in your Gmail. Make sure the Supabase cron is wired up and at least one campaign is sending."
          />
        )}

        {replies && replies.length > 0 && filteredCount === 0 && (
          <div className="text-center py-12 rounded-xl border border-dashed border-ink-200">
            <div className="text-[14px] font-medium text-ink mb-1">Nothing matches</div>
            <p className="text-[13px] text-ink-500">
              {query ? <>Nothing matches <span className="font-mono text-ink">&ldquo;{query}&rdquo;</span>.</> : "No replies match this intent filter."}
            </p>
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
            {filtered.map((r, i) => (
              <ReplyRow
                key={r.id}
                reply={r}
                onOpen={() => setActive(r)}
                onDelete={() => deleteReply(r.id)}
                deleting={deletingId === r.id}
                isLast={i === filtered.length - 1}
              />
            ))}
          </div>
        )}

        <ReplyDrawer reply={active} onClose={() => setActive(null)} />
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function IntentChip({
  label, count, active, onClick, dot, textColor, bg,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dot?: string;
  textColor?: string;
  bg?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 font-mono text-[11.5px] px-2.5 py-1 rounded-full transition-all cursor-pointer ${
        active
          ? "bg-ink text-paper"
          : "text-ink-700 hover:text-ink hover:bg-hover"
      }`}
      style={
        !active && bg
          ? { background: bg, color: textColor }
          : undefined
      }
    >
      {dot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: active ? "currentColor" : dot }}
        />
      )}
      <span>{label}</span>
      <span
        className="font-mono text-[10.5px] tabular-nums"
        style={{ opacity: active ? 0.7 : 0.85 }}
      >
        {count}
      </span>
    </button>
  );
}

function ReplyRow({
  reply, onOpen, onDelete, deleting, isLast,
}: {
  reply: ReplyItem;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
  isLast: boolean;
}) {
  const senderName = reply.recipient?.name ?? reply.from_email;
  const initial = (senderName.trim()[0] || "?").toUpperCase();
  const tone = intentTone(reply.intent as Intent | null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group w-full text-left flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-hover transition-colors ${
        isLast ? "" : "border-b border-ink-100"
      }`}
    >
      {/* Avatar */}
      <span
        className="grid place-items-center w-9 h-9 rounded-full font-mono text-[12px] font-semibold shrink-0 mt-0.5"
        style={{ background: tone.bg, color: tone.text }}
      >
        {initial}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-ink truncate">{senderName}</span>
          {reply.recipient?.company && (
            <span className="text-[12.5px] text-ink-500">@ {reply.recipient.company}</span>
          )}
          {reply.campaign && (
            <Link
              href={`/app/campaigns/${reply.campaign.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface border border-ink-200 text-ink-700 hover:bg-hover hover:text-ink transition-colors"
            >
              {reply.campaign.name}
            </Link>
          )}
          {reply.intent && (
            <IntentBadge
              intent={reply.intent as Intent}
              confidence={reply.intent_confidence}
              size="xs"
            />
          )}
        </div>
        <div className="text-[13.5px] text-ink mt-0.5 truncate" title={reply.subject ?? ""}>
          {reply.subject ?? <span className="italic text-ink-400">(no subject)</span>}
        </div>
        {reply.snippet && (
          <div className="text-[12.5px] text-ink-600 mt-0.5 line-clamp-1">{reply.snippet}</div>
        )}
        <div className="text-[11px] font-mono text-ink-400 mt-0.5">{reply.from_email}</div>
      </div>

      <div className="flex items-center gap-2 pt-1 shrink-0">
        <div className="text-[12px] font-mono text-ink-500 whitespace-nowrap">
          {reply.received_at
            ? new Date(reply.received_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : new Date(reply.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short" })}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          disabled={deleting}
          aria-label="Delete reply"
          title="Delete reply"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center w-7 h-7 rounded-md text-ink-500 hover:text-[rgb(255_140_140)] hover:bg-[rgb(255_99_99/0.08)] disabled:opacity-40 transition-all cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SkeletonReplies() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex items-start gap-3 px-4 py-3 ${i < 4 ? "border-b border-ink-100" : ""}`}>
          <div className="w-9 h-9 rounded-full bg-ink-100 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-2.5 w-1/2 rounded bg-ink-100 animate-pulse" />
            <div className="h-2 w-2/3 rounded bg-ink-100 animate-pulse" />
          </div>
          <div className="h-2.5 w-12 rounded bg-ink-100 animate-pulse mt-1" />
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.5 6.3L3 16M3 20v-4h4" />
    </svg>
  );
}
