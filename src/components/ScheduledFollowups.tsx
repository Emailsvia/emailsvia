"use client";

import { useCallback, useEffect, useState } from "react";

// Follow-ups to people who already replied, on the campaign page:
// stalled-thread nudges waiting for approval, and upcoming "not now"
// re-engagements. Approve = send at the next tick (through the usual gates:
// sending window, caps, do-not-contact, a fresh check for new replies).

type Item = {
  id: string;
  kind: "not_now" | "thread_stalled";
  status: string;
  due_at: string;
  due_source: "their_words" | "rule_delay";
  requires_approval: boolean;
  approved_at: string | null;
  recipient: { id: string; name: string; email: string; company: string } | null;
  email: { subject: string | null; template: string } | null;
  rule: { name: string } | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const KIND_LABEL: Record<Item["kind"], string> = {
  not_now: "Said “not now”",
  thread_stalled: "Went quiet after your reply",
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ScheduledFollowups({ campaignId, onOpenPerson }: {
  campaignId: string;
  onOpenPerson: (p: { id: string; name: string; email: string; company: string }) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${campaignId}/scheduled`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setItems(
      (d.items ?? []).map((x: Record<string, unknown>) => ({
        ...x,
        recipient: one(x.recipient as Item["recipient"]),
        email: one(x.email as Item["email"]),
        rule: one(x.rule as Item["rule"]),
      }))
    );
  }, [campaignId]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "skip") {
    setBusy(id);
    setErr(null);
    const r = await fetch(`/api/campaigns/${campaignId}/scheduled/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!r.ok) setErr((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
    setBusy(null);
    await load();
  }

  const waiting = (items ?? []).filter((i) => i.status === "needs_approval");
  const upcoming = (items ?? []).filter((i) => i.status === "scheduled" || i.status === "sending");
  if (!items || (waiting.length === 0 && upcoming.length === 0)) return null;

  const row = (i: Item, approval: boolean) => (
    <div key={i.id} className="border-t border-ink-100 first:border-t-0 py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <button type="button" className="text-left min-w-0" onClick={() => i.recipient && onOpenPerson(i.recipient)}>
          <div className="text-[13px] font-medium truncate">{i.recipient?.name ?? "Unknown"} <span className="text-ink-500 font-normal">· {i.recipient?.company}</span></div>
          <div className="text-[11px] font-mono text-ink-500 truncate">{i.recipient?.email}</div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="btn-primary text-xs" disabled={busy === i.id} onClick={() => act(i.id, "approve")}>
            Send now
          </button>
          <button type="button" className="btn-quiet text-xs" disabled={busy === i.id} onClick={() => act(i.id, "skip")}>
            Skip
          </button>
        </div>
      </div>
      <div className="text-[11.5px] text-ink-500">
        {KIND_LABEL[i.kind]}{i.rule?.name ? ` · ${i.rule.name}` : ""}
        {!approval && (
          <> · {i.status === "sending" ? "sending" : `due ${fmt(i.due_at)}`}{i.due_source === "their_words" ? " (the date they gave)" : ""}{i.requires_approval && !i.approved_at ? " · will wait for your approval" : ""}</>
        )}
      </div>
      {i.email && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-ink-600">Preview{i.email.subject ? `: ${i.email.subject}` : ""}</summary>
          <pre className="whitespace-pre-wrap font-mono text-[12px] text-ink-700 bg-surface border border-ink-200 rounded-md p-3 mt-2 max-h-48 overflow-auto">{i.email.template}</pre>
        </details>
      )}
    </div>
  );

  return (
    <section className="sheet p-6">
      <h2 className="text-[15px] font-semibold">Follow-ups after a reply</h2>
      <p className="text-[12px] text-ink-500 mt-1">
        Cancelled automatically if they write again. Sending still respects your sending window, limits and do-not-contact list.
      </p>
      {err && <p className="text-[12.5px] text-[rgb(252_165_165)] mt-3">{err}</p>}
      {waiting.length > 0 && (
        <div className="mt-4">
          <div className="label-cap mb-1" style={{ color: "rgb(255 180 110)" }}>Waiting for your approval ({waiting.length})</div>
          {waiting.map((i) => row(i, true))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="mt-4">
          <div className="label-cap mb-1">Scheduled ({upcoming.length})</div>
          {upcoming.map((i) => row(i, false))}
        </div>
      )}
    </section>
  );
}
