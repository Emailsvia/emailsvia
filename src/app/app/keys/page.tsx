"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

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

  async function load() {
    const r = await fetch("/api/keys", { cache: "no-store" });
    const d = await r.json();
    setKeys(d.keys ?? []);
  }
  useEffect(() => { load(); }, []);

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
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">API keys</h1>
        <p className="text-[13px] text-ink-500 mt-1 mb-6">
          Used by the Google Sheets add-on and any direct API calls. Treat them like passwords
          &mdash; we only ever show the full token once.
        </p>

        {revealed && (
          <div className="sheet p-5 mb-6 border-amber-300 bg-amber-50/70">
            <div className="text-[14px] font-semibold mb-1">Copy this now &mdash; you won&rsquo;t see it again</div>
            <p className="text-[12px] text-ink-700 mb-3">
              Key &ldquo;{revealed.name}&rdquo; was created. Paste it into the Sheets add-on or
              your code, then dismiss this banner. We don&rsquo;t store the raw value.
            </p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-[12px] bg-paper border border-ink-200 rounded px-2.5 py-1.5 flex-1 truncate">
                {revealed.raw_token}
              </code>
              <button onClick={copyToken} className="btn-ghost text-[12px]">
                {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={() => setRevealed(null)} className="btn-quiet text-[12px]">
                Dismiss
              </button>
            </div>
          </div>
        )}

        <form onSubmit={create} className="sheet p-5 mb-6">
          <h2 className="text-[14px] font-semibold mb-3">Create a new key</h2>
          <div className="flex items-end gap-2">
            <div className="flex-1">
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
          {err && <p className="mt-2 text-[12px] text-red-600">{err}</p>}
        </form>

        {keys === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {keys && keys.length === 0 && !revealed && (
          <div className="text-center py-12 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No API keys yet</div>
            <p className="text-[13px] text-ink-500">
              Create your first key above to connect the Sheets add-on or call the public API.
            </p>
          </div>
        )}

        {keys && keys.length > 0 && (
          <div className="sheet overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-500 text-left">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Prefix</th>
                  <th className="px-4 py-2.5 font-medium">Last used</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-ink-100">
                    <td className="px-4 py-2.5 font-medium">{k.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-600">{k.prefix}…</td>
                    <td className="px-4 py-2.5 text-ink-600">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-2.5 text-ink-600">
                      {new Date(k.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => revoke(k.id, k.prefix)}
                        className="btn-quiet text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 sheet p-5">
          <h3 className="text-[14px] font-semibold mb-2">Using your key</h3>
          <p className="text-[12px] text-ink-600 mb-3">
            Pass the token as a Bearer header on every request to the public API.
          </p>
          <pre className="text-[11px] font-mono bg-surface border border-ink-200 rounded px-3 py-2 overflow-x-auto">
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/campaigns/from-sheet \\
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
          </pre>
        </div>
      </div>
    </AppShell>
  );
}
