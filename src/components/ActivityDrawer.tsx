"use client";

import { useEffect } from "react";

export type TimelineEvent = {
  kind: string;
  at: string;
  meta?: Record<string, string | null> | null;
};

export type ActivityRecipient = {
  id: string;
  name: string;
  email: string;
  company: string;
  status: string;
  opens: number;
  clicks: number;
  replied: boolean;
  score: number;
  timeline: TimelineEvent[];
};

function relative(from: string, to: string) {
  const diffSec = Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
  return `${Math.round(diffSec / 86400)}d`;
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function eventLabel(e: TimelineEvent): { icon: React.ReactNode; label: string; detail?: string } {
  const Icon = ({ path }: { path: string }) => (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
  if (e.kind === "initial") return { icon: <Icon path="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />, label: "Sent" };
  if (e.kind === "retry") return { icon: <Icon path="M3 12a9 9 0 015.66-8.34M21 12a9 9 0 01-15.66 6.34M21 4v6h-6M3 20v-6h6" />, label: "Retry sent" };
  if (e.kind.startsWith("follow_up")) {
    const n = e.kind.replace("follow_up_", "");
    return { icon: <Icon path="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />, label: `Follow-up #${n}` };
  }
  if (e.kind === "open") return {
    icon: <Icon path="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0" />,
    label: "Opened",
    detail: e.meta?.user_agent ? shortUA(e.meta.user_agent) : undefined,
  };
  if (e.kind === "click") return {
    icon: <Icon path="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />,
    label: "Clicked",
    detail: e.meta?.url ?? undefined,
  };
  if (e.kind === "reply") return {
    icon: <Icon path="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />,
    label: "Replied",
    detail: e.meta?.subject ?? undefined,
  };
  return { icon: <Icon path="M5 12h14" />, label: e.kind };
}

function shortUA(ua: string | null): string {
  if (!ua) return "";
  if (/iphone|ipad/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return "";
}

export default function ActivityDrawer({
  recipient,
  onClose,
}: {
  recipient: ActivityRecipient | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!recipient) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [recipient, onClose]);

  if (!recipient) return null;

  const sentAt = recipient.timeline.find((e) => e.kind === "initial" || e.kind === "retry")?.at;

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <aside
        className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-paper border-l border-ink-200 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-paper border-b border-ink-200 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">Recipient activity</div>
            <div className="text-[16px] font-semibold mt-0.5 truncate">{recipient.name}</div>
            <div className="text-[13px] text-ink-600 truncate">{recipient.company}</div>
            <div className="text-[11px] font-mono text-ink-500 truncate mt-0.5">{recipient.email}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-quiet p-1.5 shrink-0" aria-label="Close">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-3 border-b border-ink-200">
          <Stat label="Opens" value={recipient.opens} />
          <Stat label="Clicks" value={recipient.clicks} />
          <Stat label="Score" value={recipient.score} highlight />
        </div>

        <div className="px-5 py-5">
          <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider mb-4">Timeline</div>
          {recipient.timeline.length === 0 && (
            <div className="text-[13px] text-ink-500">No activity yet.</div>
          )}
          <ol className="space-y-4 relative">
            {recipient.timeline.map((e, i) => {
              const l = eventLabel(e);
              const delta = sentAt && e.at !== sentAt ? relative(sentAt, e.at) : null;
              return (
                <li key={i} className="relative pl-7">
                  <div className="absolute left-0 top-0.5 w-5 h-5 rounded-full border border-ink-200 bg-paper flex items-center justify-center text-ink-600">
                    {l.icon}
                  </div>
                  {i < recipient.timeline.length - 1 && (
                    <div className="absolute left-[9.5px] top-5 bottom-[-16px] w-px bg-ink-200" />
                  )}
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">{l.label}</span>
                    <span className="text-[11px] font-mono text-ink-500">
                      {fmt(e.at)}
                      {delta && <span className="text-ink-400"> · +{delta}</span>}
                    </span>
                  </div>
                  {l.detail && (
                    <div className="text-[12px] text-ink-600 mt-0.5 break-all">{l.detail}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="px-5 py-3 border-r last:border-r-0 border-ink-200">
      <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">{label}</div>
      <div className={`text-[20px] font-bold mt-0.5 ${highlight ? "text-ink" : "text-ink-900"}`}>{value}</div>
    </div>
  );
}
