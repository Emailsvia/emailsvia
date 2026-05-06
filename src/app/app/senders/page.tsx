"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

type Sender = {
  id: string;
  label: string;
  email: string;
  from_name: string | null;
  is_default: boolean;
  warmup_enabled: boolean;
  warmup_started_at: string | null;
  auth_method?: "oauth" | "app_password";
  oauth_status?: "ok" | "revoked" | "pending";
  created_at: string;
};

function warmupStatus(s: Sender) {
  if (!s.warmup_enabled || !s.warmup_started_at) return null;
  const days = Math.floor((Date.now() - new Date(s.warmup_started_at).getTime()) / 86_400_000);
  const ramp = [10, 20, 40, 60, 100, 150, 200, 250, 300, 350, 400, 400, 400, 400];
  if (days >= ramp.length) return { done: true, day: ramp.length, cap: null as number | null };
  return { done: false, day: days + 1, cap: ramp[Math.max(0, days)] };
}

export default function SendersPage() {
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", email: "", app_password: "", from_name: "", is_default: false, warmup_enabled: false });
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function load() {
    const r = await fetch("/api/senders", { cache: "no-store" });
    const data = await r.json();
    setSenders(data.senders ?? []);
  }
  useEffect(() => {
    load();
    // OAuth callback redirects here with either ?connected=email or ?oauth_error=...
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthErr = params.get("oauth_error");
    if (connected) {
      setFlash({ kind: "ok", msg: `Connected ${connected} via Google OAuth.` });
      // Clean the URL so a refresh doesn't re-trigger the toast.
      window.history.replaceState({}, "", "/app/senders");
    } else if (oauthErr) {
      setFlash({ kind: "err", msg: `Couldn't connect: ${oauthErr}` });
      window.history.replaceState({}, "", "/app/senders");
    }
  }, []);

  function connectGoogle() {
    window.location.href = "/api/auth/google/connect?next=/app/senders";
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const r = await fetch("/api/senders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: form.label,
        email: form.email.toLowerCase().trim(),
        app_password: form.app_password,
        from_name: form.from_name || null,
        is_default: form.is_default,
        warmup_enabled: form.warmup_enabled,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (typeof j.error === "string") setErr(j.error);
      else if (j.error && typeof j.error === "object") setErr(JSON.stringify(j.error));
      else setErr(`Failed (HTTP ${r.status}).`);
      return;
    }
    setForm({ label: "", email: "", app_password: "", from_name: "", is_default: false, warmup_enabled: false });
    setAdding(false);
    await load();
  }

  async function setDefault(id: string) {
    await fetch(`/api/senders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this sender? Campaigns using it will fall back to the env-var Gmail.")) return;
    await fetch(`/api/senders/${id}`, { method: "DELETE" });
    await load();
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ label: string; from_name: string }>({ label: "", from_name: "" });
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(s: Sender) {
    setEditingId(s.id);
    setEditForm({ label: s.label, from_name: s.from_name ?? "" });
  }
  async function saveEdit(id: string) {
    setEditSaving(true);
    await fetch(`/api/senders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: editForm.label, from_name: editForm.from_name || null }),
    });
    setEditSaving(false);
    setEditingId(null);
    await load();
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight">Senders</h1>
            <p className="text-[13px] text-ink-500 mt-1">Gmail accounts authorized to send campaigns.</p>
          </div>
          {!adding && (
            <div className="flex items-center gap-2">
              <button className="btn-accent" onClick={connectGoogle}>Connect Gmail</button>
              <button className="btn-ghost" onClick={() => setAdding(true)}>Use app password</button>
            </div>
          )}
        </div>

        {flash && (
          <div
            className={
              "mb-4 px-3 py-2 rounded-md text-[13px] " +
              (flash.kind === "ok"
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700")
            }
          >
            {flash.msg}
          </div>
        )}

        {adding && (
          <form onSubmit={onAdd} className="sheet p-5 mb-6">
            <h2 className="text-[16px] font-semibold mb-1">New sender</h2>
            <p className="text-[13px] text-ink-500 mb-5">
              Use an <b>app password</b>, not your Gmail login. Generate at{" "}
              <a className="btn-link" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                myaccount.google.com/apppasswords
              </a>
              . 2FA must be on.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label-cap">Label</label>
                <input className="field-boxed" placeholder="Personal · Work" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
              </div>
              <div>
                <label className="label-cap">Display name</label>
                <input className="field-boxed" placeholder="Your full name" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
              </div>
              <div>
                <label className="label-cap">Gmail address</label>
                <input className="field-boxed" type="email" placeholder="you@gmail.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div>
                <label className="label-cap">App password</label>
                <input className="field-boxed font-mono" placeholder="xxxx xxxx xxxx xxxx" value={form.app_password} onChange={(e) => setForm({ ...form, app_password: e.target.value })} required />
                <p className="text-[11px] text-ink-500 mt-1.5">16 lowercase letters Google generates — not your login password.</p>
              </div>
            </div>

            <div className="mt-5 space-y-2.5">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer w-fit">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="w-4 h-4 accent-accent" />
                <span>Make this the default sender for new campaigns</span>
              </label>
              <label className="flex items-start gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" checked={form.warmup_enabled} onChange={(e) => setForm({ ...form, warmup_enabled: e.target.checked })} className="w-4 h-4 mt-0.5 accent-accent" />
                <div>
                  <div>Enable 14-day warmup</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Ramps from 10/day up to 400/day over 14 days. Essential for brand new Gmail accounts — without it they get flagged as spam fast.</div>
                </div>
              </label>
            </div>

            {err && (
              <div className="mt-4 bg-red-50 text-red-700 text-[13px] px-3 py-2 rounded-md">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-ink-100">
              <button type="button" className="btn-quiet" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
              <button type="submit" disabled={saving} className="btn-accent">
                {saving ? "Verifying…" : "Add & verify"}
              </button>
            </div>
          </form>
        )}

        {senders === null && <p className="text-[13px] text-ink-500">Loading…</p>}

        {senders?.length === 0 && !adding && (
          <div className="text-center py-16 border border-dashed border-ink-200 rounded-lg">
            <div className="text-[14px] font-medium text-ink mb-1">No senders yet</div>
            <p className="text-[13px] text-ink-500 mb-4">Connect a Gmail account to start sending.</p>
            <div className="flex items-center justify-center gap-2">
              <button onClick={connectGoogle} className="btn-accent">Connect Gmail</button>
              <button onClick={() => setAdding(true)} className="btn-ghost">Use app password</button>
            </div>
          </div>
        )}

        {senders && senders.length > 0 && (
          <div className="sheet overflow-hidden">
            {senders.map((s) => (
              <div key={s.id} className="border-b border-ink-100 last:border-b-0">
                {editingId === s.id ? (
                  <div className="px-4 py-4 bg-surface space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="label-cap">Label</label>
                        <input
                          className="field-boxed"
                          value={editForm.label}
                          onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="label-cap">Display name (the recipient sees this)</label>
                        <input
                          className="field-boxed"
                          value={editForm.from_name}
                          onChange={(e) => setEditForm({ ...editForm, from_name: e.target.value })}
                          placeholder="Your full name"
                        />
                      </div>
                    </div>
                    <div className="text-[12px] text-ink-500">
                      Email <span className="font-mono">{s.email}</span> can't be changed. Delete and re-add to switch accounts.
                    </div>
                    <div className="flex justify-end gap-2">
                      <button className="btn-quiet text-[12px]" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn-accent text-[12px]" disabled={editSaving || !editForm.label.trim()} onClick={() => saveEdit(s.id)}>
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-hover transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-medium truncate">{s.label}</span>
                        {s.is_default && <span className="pill-live">default</span>}
                        {s.auth_method === "oauth" ? (
                          <span className="pill-done">OAuth</span>
                        ) : (
                          <span className="pill-draft">app password</span>
                        )}
                        {s.auth_method === "oauth" && s.oauth_status === "revoked" && (
                          <span className="pill-pause">revoked — reconnect</span>
                        )}
                        {(() => {
                          const w = warmupStatus(s);
                          if (!w) return null;
                          return w.done
                            ? <span className="pill-done">warmup done</span>
                            : <span className="pill-pause">warmup day {w.day}/14 · {w.cap}/day</span>;
                        })()}
                      </div>
                      <div className="text-[13px] text-ink-500 truncate mt-0.5">
                        {s.from_name ? <>{s.from_name} <span className="text-ink-400">&lt;{s.email}&gt;</span></> : s.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {s.auth_method === "oauth" && s.oauth_status === "revoked" && (
                        <button className="btn-quiet text-[12px]" onClick={connectGoogle}>Reconnect</button>
                      )}
                      <button className="btn-quiet text-[12px]" onClick={() => startEdit(s)}>Edit</button>
                      {!s.is_default && <button className="btn-quiet text-[12px]" onClick={() => setDefault(s.id)}>Set default</button>}
                      <button className="btn-quiet text-[12px] text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => remove(s.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
