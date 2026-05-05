"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Sender = {
  id: string;
  label: string;
  email: string;
  auth_method?: "oauth" | "app_password";
  oauth_status?: "ok" | "revoked" | "pending";
};

type Rotation = {
  rotation: Array<{ sender_id: string; sender: Sender | null }>;
  sender_limit: number;
  plan_id: "free" | "starter" | "growth" | "scale";
};

// Inbox-rotation editor for a campaign. Lets the user attach multiple
// senders so the tick can split sends across them. Free / Starter (limit
// 1) only ever see their default sender; Growth (3) and Scale (10) get
// the multi-select.
export default function RotationPanel({
  campaignId,
  allSenders,
}: {
  campaignId: string;
  allSenders: Sender[];
}) {
  const [data, setData] = useState<Rotation | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/campaigns/${campaignId}/senders`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function save(nextIds: string[]) {
    setSaving(true);
    setErr(null);
    const r = await fetch(`/api/campaigns/${campaignId}/senders`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_ids: nextIds }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.message ?? j.error ?? "Failed to save.");
      return;
    }
    await load();
  }

  if (!data) return null;

  const attachedIds = new Set(data.rotation.map((r) => r.sender_id));
  const canAddMore = data.rotation.length < data.sender_limit;
  const remaining = allSenders.filter((s) => !attachedIds.has(s.id));

  // Free / Starter: rotation isn't really a feature — show an upgrade nudge
  // instead of the multi-select to keep the panel honest.
  if (data.sender_limit <= 1) {
    return (
      <div className="sheet p-5">
        <h3 className="text-[14px] font-semibold mb-1">Inbox rotation</h3>
        <p className="text-[12px] text-ink-500 mb-3">
          Split a campaign across multiple connected Gmails so each stays under its
          warmup ceiling.
        </p>
        <Link href="/app/billing" className="btn-ghost text-[12px]">
          Upgrade to Growth or Scale
        </Link>
      </div>
    );
  }

  return (
    <div className="sheet p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold">Inbox rotation</h3>
        <span className="text-[11px] font-mono text-ink-500">
          {data.rotation.length} / {data.sender_limit}
        </span>
      </div>
      <p className="text-[12px] text-ink-500 mb-3">
        Tick picks the least-loaded eligible sender each minute. Empty &rarr; falls
        back to the campaign&rsquo;s default sender.
      </p>

      {data.rotation.length === 0 ? (
        <div className="text-[12px] text-ink-500 italic mb-3">No senders attached.</div>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {data.rotation.map((r) => (
            <li
              key={r.sender_id}
              className="flex items-center justify-between gap-2 text-[13px] border border-ink-100 rounded-md px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{r.sender?.label ?? "(deleted)"}</div>
                <div className="truncate text-[11px] text-ink-500 font-mono">
                  {r.sender?.email}
                  {r.sender?.auth_method === "oauth" && r.sender.oauth_status !== "ok" && (
                    <span className="ml-1 text-amber-600">· revoked</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => save(data.rotation.map((x) => x.sender_id).filter((x) => x !== r.sender_id))}
                disabled={saving}
                className="btn-quiet text-[11px]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {remaining.length > 0 && canAddMore && (
        <select
          className="field-boxed text-[13px]"
          disabled={saving}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            save([...data.rotation.map((x) => x.sender_id), v]);
          }}
        >
          <option value="">+ Add sender…</option>
          {remaining.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.email}
            </option>
          ))}
        </select>
      )}

      {!canAddMore && (
        <p className="text-[11px] text-ink-500">
          {data.plan_id === "scale"
            ? "Maximum reached for Scale."
            : <>Maximum reached for your plan. <Link href="/app/billing" className="underline">Upgrade</Link> for more.</>}
        </p>
      )}

      {err && <p className="mt-2 text-[12px] text-red-600">{err}</p>}
    </div>
  );
}
