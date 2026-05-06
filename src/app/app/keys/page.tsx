"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import EmptyState from "@/components/app/EmptyState";
import CodeBlock from "@/components/app/CodeBlock";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
};

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; raw_token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  async function load() {
    const r = await fetch("/api/keys", { cache: "no-store" });
    const d = await r.json();
    setKeys(d.keys ?? []);
  }
  useEffect(() => {
    load();
    setOrigin(window.location.origin);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setCreating(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? `Failed (${r.status})`);
        return;
      }
      setRevealed({ name, raw_token: d.raw_token });
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, prefix: string) {
    if (!confirm(`Revoke key ${prefix}…? Any tool using it stops working immediately.`)) return;
    const r = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (!r.ok) {
      alert("Failed to revoke key.");
      return;
    }
    await load();
  }

  async function copyToken() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.raw_token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          eyebrow="Settings · Developer"
          title="API keys"
          subtitle="For the Google Sheets add-on and direct API calls. Treat them like passwords — the full token shows once, never again."
        />

        {revealed && (
          <RevealedSecretCard
            label={`Key "${revealed.name}" created`}
            description="Paste it into the Sheets add-on or your code right now. We don't store the raw value, so this is your only chance to see it."
            secret={revealed.raw_token}
            copied={copied}
            onCopy={copyToken}
            onDismiss={() => setRevealed(null)}
          />
        )}

        <form
          onSubmit={create}
          className="rounded-xl border border-ink-200 bg-paper p-5 mb-6"
        >
          <h2 className="text-[14px] font-semibold mb-3">Create a new key</h2>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="key-name" className="label-cap">Label</label>
              <input
                id="key-name"
                className="field-boxed"
                placeholder="Sheets add-on · personal laptop · CI"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="btn-accent"
            >
              {creating ? "Creating…" : "Create key"}
            </button>
          </div>
          {err && (
            <div
              className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg text-[13px] border"
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
        </form>

        {keys === null && <SkeletonKeyList />}

        {keys && keys.length === 0 && !revealed && (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="8" cy="15" r="4" />
                <path d="M11 12l9-9M16 7l3 3" />
              </svg>
            }
            title="No API keys yet"
            body="Create your first key above to connect the Sheets add-on or call the public API. Keys are scoped to your account and can be revoked any time."
          />
        )}

        {keys && keys.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.4fr,1fr,1fr,1fr,auto] gap-3 px-4 py-2.5 border-b border-ink-200 bg-surface">
              <ColHead>Name</ColHead>
              <ColHead>Prefix</ColHead>
              <ColHead>Last used</ColHead>
              <ColHead>Created</ColHead>
              <ColHead> </ColHead>
            </div>
            {keys.map((k, i) => (
              <div
                key={k.id}
                className={`md:grid md:grid-cols-[1.4fr,1fr,1fr,1fr,auto] md:gap-3 md:items-center px-4 py-3 hover:bg-hover transition-colors ${
                  i < keys.length - 1 ? "border-b border-ink-100" : ""
                }`}
              >
                <div className="text-[13.5px] font-medium text-ink truncate">{k.name}</div>
                <div className="font-mono text-[12px] text-ink-600 truncate mt-1 md:mt-0">
                  {k.prefix}…
                </div>
                <div className="text-[12.5px] text-ink-600 mt-0.5 md:mt-0">
                  {k.last_used_at
                    ? new Date(k.last_used_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : <span className="text-ink-400">never</span>
                  }
                </div>
                <div className="font-mono text-[12px] text-ink-500 mt-0.5 md:mt-0">
                  {new Date(k.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
                <div className="mt-2 md:mt-0 md:text-right">
                  <button
                    onClick={() => revoke(k.id, k.prefix)}
                    className="btn-quiet text-[12.5px] text-[rgb(252_165_165)] hover:text-[rgb(255_140_140)]"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="mt-10">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 mb-3">
            Using your key
          </div>
          <p className="text-[13px] text-ink-600 mb-3 max-w-2xl">
            Pass the token as a Bearer header on every request to the public API.
          </p>
          <CodeBlock language="bash" copyable>
{`curl -X POST ${origin}/api/v1/campaigns/from-sheet \\
  -H "Authorization: Bearer eav_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Q2 outreach",
    "subject": "Quick question, {{Name}}",
    "template": "Hi {{Name}},\\n\\n...",
    "rows": [
      {"email": "alex@acme.com", "name": "Alex", "company": "Acme"}
    ]
  }'`}
          </CodeBlock>
        </section>
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium">
      {children}
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
          <div className="text-[14px] font-semibold text-ink">{label}</div>
          <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">{description}</p>
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

function SkeletonKeyList() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`grid grid-cols-[1.4fr,1fr,1fr,1fr,auto] gap-3 items-center px-4 py-3 ${
            i < 2 ? "border-b border-ink-100" : ""
          }`}
        >
          <div className="h-3 w-2/3 rounded bg-ink-100 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-ink-100 animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-ink-100 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-ink-100 animate-pulse" />
          <div className="h-7 w-14 rounded bg-ink-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
