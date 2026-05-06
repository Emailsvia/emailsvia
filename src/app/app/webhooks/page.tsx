"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  last_used_at: string | null;
  created_at: string;
};

const ALL_EVENTS = [
  { id: "reply.received", label: "Reply received" },
  { id: "reply.classified", label: "Reply classified (AI intent)" },
  { id: "recipient.unsubscribed", label: "Recipient unsubscribed" },
  { id: "campaign.finished", label: "Campaign finished" },
];

export default function WebhooksPage() {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; url: string; events: string[] }>({
    name: "",
    url: "",
    events: ALL_EVENTS.map((e) => e.id),
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    const r = await fetch("/api/webhooks", { cache: "no-store" });
    const d = await r.json();
    setHooks(d.webhooks ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? `Failed (${r.status})`);
        return;
      }
      setRevealed({ name: d.webhook.name, secret: d.secret });
      setForm({ name: "", url: "", events: ALL_EVENTS.map((e) => e.id) });
      setCreating(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/webhooks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    await load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete webhook "${name}"? Endpoint stops receiving events immediately.`)) return;
    await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    await load();
  }

  async function copySecret() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleEvent(eventId: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(eventId)
        ? f.events.filter((e) => e !== eventId)
        : [...f.events, eventId],
    }));
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">Webhooks</h1>
            <p className="text-[13px] text-ink-500 mt-1">
              POST EmailsVia events to your CRM, Zapier, or anywhere that takes JSON.
            </p>
          </div>
          {!creating && (
            <button onClick={() => setCreating(true)} className="btn-accent">+ Add webhook</button>
          )}
        </div>

        {revealed && (
          <div className="sheet p-5 mb-6 border-amber-300 bg-amber-50/70">
            <div className="text-[14px] font-semibold mb-1">Copy this secret &mdash; you won&rsquo;t see it again</div>
            <p className="text-[12px] text-ink-700 mb-3">
              Use it to verify the <code>EmailsVia-Signature</code> header on your endpoint.
              We sign every request body with HMAC-SHA256 using this secret.
            </p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-[12px] bg-paper border border-ink-200 rounded px-2.5 py-1.5 flex-1 truncate">
                {revealed.secret}
              </code>
              <button onClick={copySecret} className="btn-ghost text-[12px]">
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={() => setRevealed(null)} className="btn-quiet text-[12px]">Dismiss</button>
            </div>
          </div>
        )}

        {creating && (
          <form onSubmit={create} className="sheet p-5 mb-6">
            <h2 className="text-[14px] font-semibold mb-3">New webhook</h2>
            <div className="space-y-3">
              <div>
                <label className="label-cap">Name</label>
                <input
                  className="field-boxed"
                  placeholder="Zapier · production CRM · Slack hook"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  maxLength={100}
                />
              </div>
              <div>
                <label className="label-cap">Endpoint URL</label>
                <input
                  className="field-boxed font-mono text-[12px]"
                  type="url"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  required
                />
                <p className="text-[11px] text-ink-500 mt-1.5">
                  HTTPS required in production. Localhost is allowed in dev.
                </p>
              </div>
              <div>
                <label className="label-cap">Events</label>
                <div className="space-y-1.5">
                  {ALL_EVENTS.map((e) => (
                    <label key={e.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.events.includes(e.id)}
                        onChange={() => toggleEvent(e.id)}
                        className="w-4 h-4 accent-accent"
                      />
                      <span className="font-mono text-[12px] text-ink-700 w-44">{e.id}</span>
                      <span className="text-ink-500">{e.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {err && <p className="mt-3 text-[12px] text-red-600">{err}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setCreating(false); setErr(null); }}
                className="btn-quiet"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.name || !form.url || form.events.length === 0}
                className="btn-accent"
              >
                {saving ? "Creating…" : "Create webhook"}
              </button>
            </div>
          </form>
        )}

        {hooks === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {hooks && hooks.length === 0 && !creating && !revealed && (
          <div className="text-center py-12 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No webhooks yet</div>
            <p className="text-[13px] text-ink-500 mb-4">
              Set up a webhook to push reply data into your own pipeline in real time.
            </p>
            <button onClick={() => setCreating(true)} className="btn-accent">Add your first</button>
          </div>
        )}

        {hooks && hooks.length > 0 && (
          <div className="sheet overflow-hidden">
            {hooks.map((h) => (
              <div key={h.id} className="border-b border-ink-100 last:border-b-0 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-medium truncate">{h.name}</span>
                      <span className={"text-[11px] font-medium px-1.5 py-0.5 rounded " + (h.active ? "bg-green-50 text-green-700" : "bg-ink-100 text-ink-500")}>
                        {h.active ? "active" : "paused"}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink-500 truncate font-mono mt-0.5">{h.url}</div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {h.events.length} event{h.events.length === 1 ? "" : "s"} ·{" "}
                      {h.last_used_at ? `last delivered ${new Date(h.last_used_at).toLocaleString()}` : "never delivered"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggle(h.id, !h.active)}
                      className="btn-quiet text-[12px]"
                    >
                      {h.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => remove(h.id, h.name)}
                      className="btn-quiet text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 sheet p-5">
          <h3 className="text-[14px] font-semibold mb-2">Verifying signatures</h3>
          <p className="text-[12px] text-ink-600 mb-3">
            Every POST carries an <code className="font-mono">EmailsVia-Signature</code> header
            of the form <code className="font-mono">sha256=&lt;hex&gt;</code> &mdash; HMAC-SHA256 of
            the raw request body using your webhook secret.
          </p>
          <pre className="text-[11px] font-mono bg-surface border border-ink-200 rounded px-3 py-2 overflow-x-auto">
{`// Node.js verifier
import crypto from "crypto";

function verify(rawBody, signatureHeader, secret) {
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected)
  );
}`}
          </pre>
        </div>
      </div>
    </AppShell>
  );
}
