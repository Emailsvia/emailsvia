"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import EmptyState from "@/components/app/EmptyState";
import CodeBlock from "@/components/app/CodeBlock";

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
  { id: "reply.received",         label: "Reply received" },
  { id: "reply.classified",       label: "Reply classified (AI intent)" },
  { id: "recipient.unsubscribed", label: "Recipient unsubscribed" },
  { id: "campaign.finished",      label: "Campaign finished" },
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
    window.setTimeout(() => setCopied(false), 2000);
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
      <div className="page">
        <PageHeader
          eyebrow="Settings · Developer"
          title="Webhooks"
          subtitle="POST EmailsVia events to your CRM, Zapier, or anywhere that takes JSON. Every payload is HMAC-SHA256 signed with your secret."
          actions={
            !creating && (
              <button onClick={() => setCreating(true)} className="btn-accent">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add webhook
              </button>
            )
          }
        />

        {revealed && (
          <RevealedSecretCard
            label={`Secret for "${revealed.name}"`}
            description="Use it to verify the EmailsVia-Signature header on your endpoint. We sign every request body with HMAC-SHA256 using this secret."
            secret={revealed.secret}
            copied={copied}
            onCopy={copySecret}
            onDismiss={() => setRevealed(null)}
          />
        )}

        {creating && (
          <form
            onSubmit={create}
            className="rounded-xl border border-ink-200 bg-paper p-5 sm:p-6 mb-6"
          >
            <h2 className="text-[14px] font-semibold mb-4">New webhook</h2>
            <div className="space-y-4">
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
                  className="field-boxed font-mono text-[12.5px]"
                  type="url"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  required
                />
                <p className="text-[11.5px] text-ink-500 mt-1.5">
                  HTTPS required in production. Localhost allowed in dev.
                </p>
              </div>
              <div>
                <label className="label-cap">Events</label>
                <div className="space-y-1.5 mt-1">
                  {ALL_EVENTS.map((e) => {
                    const checked = form.events.includes(e.id);
                    return (
                      <label
                        key={e.id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          checked ? "bg-hover" : "hover:bg-hover"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvent(e.id)}
                          className="w-4 h-4 accent-accent"
                        />
                        <span className="font-mono text-[12.5px] text-ink min-w-[180px]">{e.id}</span>
                        <span className="text-[12.5px] text-ink-500">{e.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {err && (
              <div
                className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg text-[13px] border"
                style={{
                  borderColor: "rgb(255 99 99 / 0.30)",
                  background: "rgb(255 99 99 / 0.06)",
                  color: "rgb(255 140 140)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>{err}</span>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-ink-100 flex justify-end gap-2">
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

        {hooks === null && <SkeletonHookList />}

        {hooks && hooks.length === 0 && !creating && !revealed && (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="6" cy="17" r="3" />
                <circle cx="18" cy="17" r="3" />
                <circle cx="12" cy="6" r="3" />
                <path d="M12 9l-4 6M12 9l4 6M9 17h6" />
              </svg>
            }
            title="No webhooks yet"
            body="Set up a webhook to push reply data into your own pipeline in real time."
            action={
              <button onClick={() => setCreating(true)} className="btn-accent">
                Add your first webhook
              </button>
            }
          />
        )}

        {hooks && hooks.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
            {hooks.map((h, i) => (
              <div
                key={h.id}
                className={`px-4 py-3.5 hover:bg-hover transition-colors ${
                  i < hooks.length - 1 ? "border-b border-ink-100" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-medium text-ink truncate">{h.name}</span>
                      <ActiveBadge active={h.active} />
                    </div>
                    <div className="font-mono text-[12px] text-ink-600 truncate mt-1">{h.url}</div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
                        {h.events.length} event{h.events.length === 1 ? "" : "s"}
                      </span>
                      <span className="text-ink-300">·</span>
                      <span className="text-[11.5px] text-ink-500">
                        {h.last_used_at
                          ? <>last delivered <span className="font-mono text-ink-700">{relative(h.last_used_at)}</span></>
                          : <span className="font-mono text-ink-400">never delivered</span>
                        }
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggle(h.id, !h.active)}
                      className="btn-quiet text-[12.5px]"
                    >
                      {h.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => remove(h.id, h.name)}
                      className="btn-quiet text-[12.5px] text-[rgb(252_165_165)] hover:text-[rgb(255_140_140)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="mt-10">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 mb-3">
            Verifying signatures
          </div>
          <p className="text-[13px] text-ink-600 mb-3 max-w-2xl">
            Every POST carries an{" "}
            <code className="font-mono text-[12px] bg-surface border border-ink-200 px-1.5 py-0.5 rounded text-ink">
              EmailsVia-Signature
            </code>{" "}
            header of the form{" "}
            <code className="font-mono text-[12px] bg-surface border border-ink-200 px-1.5 py-0.5 rounded text-ink">
              sha256=&lt;hex&gt;
            </code>{" "}
            — HMAC-SHA256 of the raw request body using your webhook secret.
          </p>
          <CodeBlock language="javascript" copyable>
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
          </CodeBlock>
        </section>
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function ActiveBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{ background: "rgb(16 185 129 / 0.10)", color: "rgb(110 231 183)" }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: "rgb(16 185 129)", boxShadow: "0 0 6px rgb(16 185 129 / 0.7)" }}
        />
        active
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "rgb(255 255 255 / 0.04)", color: "rgb(161 161 170)" }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "rgb(113 113 122)" }} />
      paused
    </span>
  );
}

function RevealedSecretCard({
  label, description, secret, copied, onCopy, onDismiss,
}: {
  label: string;
  description: string;
  secret: string;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-5 mb-6 border"
      style={{
        borderColor: "rgb(255 99 99 / 0.30)",
        background: "rgb(255 99 99 / 0.05)",
        boxShadow: "0 0 60px -20px rgb(255 99 99 / 0.30)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
          style={{ background: "rgb(255 99 99 / 0.18)", color: "rgb(255 140 140)" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 16h.01" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-ink">Copy this now — you won&rsquo;t see it again</div>
          <div className="text-[12.5px] text-ink-700 mt-0.5">{label}</div>
          <p className="text-[12.5px] text-ink-600 mt-1.5 leading-relaxed">{description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <code className="font-mono text-[12.5px] bg-paper border border-ink-200 rounded-lg px-3 py-2 flex-1 min-w-[200px] truncate text-ink">
          {secret}
        </code>
        <button onClick={onCopy} className="btn-accent text-[12.5px] py-2">
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12l5 5L20 7" />
              </svg>
              Copied
            </>
          ) : (
            "Copy"
          )}
        </button>
        <button onClick={onDismiss} className="btn-quiet text-[12.5px]">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function SkeletonHookList() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className={`px-4 py-3.5 ${i < 1 ? "border-b border-ink-100" : ""}`}
        >
          <div className="space-y-2">
            <div className="h-3 w-1/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-2.5 w-1/2 rounded bg-ink-100 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function relative(dt: string): string {
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dt).toLocaleDateString();
}
