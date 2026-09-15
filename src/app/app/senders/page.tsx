"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import EmptyState from "@/components/app/EmptyState";

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
  provider?: "gmail" | "smtp";
  smtp_host?: string | null;
  send_as_email?: string | null;
  created_at: string;
};

type Preset = {
  name: string;
  smtp_host: string; smtp_port: number; smtp_secure: boolean;
  imap_host: string; imap_port: number; imap_secure: boolean;
  hint?: string;
};

// Common hosted-mail providers. "Other" = user fills the fields manually.
const PRESETS: Record<string, Preset> = {
  spaceship: {
    name: "Spaceship (Spacemail)",
    smtp_host: "mail.spacemail.com", smtp_port: 465, smtp_secure: true,
    imap_host: "mail.spacemail.com", imap_port: 993, imap_secure: true,
    hint: "Use the mailbox password. Confirm hosts under Spaceship → Email → Mail client setup.",
  },
  zoho: {
    name: "Zoho Mail",
    smtp_host: "smtp.zoho.com", smtp_port: 465, smtp_secure: true,
    imap_host: "imap.zoho.com", imap_port: 993, imap_secure: true,
    hint: "EU/IN accounts use smtp.zoho.eu / smtp.zoho.in. Needs IMAP enabled in Zoho settings.",
  },
  outlook: {
    name: "Outlook / Microsoft 365",
    smtp_host: "smtp.office365.com", smtp_port: 587, smtp_secure: false,
    imap_host: "outlook.office365.com", imap_port: 993, imap_secure: true,
    hint: "Requires SMTP AUTH enabled for the mailbox in the M365 admin center.",
  },
  other: {
    name: "Other (enter manually)",
    smtp_host: "", smtp_port: 465, smtp_secure: true,
    imap_host: "", imap_port: 993, imap_secure: true,
  },
};

const EMPTY_FORM = {
  label: "", email: "", app_password: "", from_name: "", is_default: false, warmup_enabled: false,
  send_as_email: "",
  preset: "spaceship",
  smtp_host: PRESETS.spaceship.smtp_host, smtp_port: PRESETS.spaceship.smtp_port, smtp_secure: PRESETS.spaceship.smtp_secure,
  imap_host: PRESETS.spaceship.imap_host, imap_port: PRESETS.spaceship.imap_port, imap_secure: PRESETS.spaceship.imap_secure,
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
  // null = form closed; otherwise which kind of sender is being added.
  const [adding, setAddingMode] = useState<null | "gmail" | "smtp">(null);
  const setAdding = (mode: false | "gmail" | "smtp") => setAddingMode(mode || null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const isSmtp = adding === "smtp";

  function applyPreset(key: string) {
    const p = PRESETS[key];
    setForm((f) => ({
      ...f, preset: key,
      smtp_host: p.smtp_host, smtp_port: p.smtp_port, smtp_secure: p.smtp_secure,
      imap_host: p.imap_host, imap_port: p.imap_port, imap_secure: p.imap_secure,
    }));
  }
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function load() {
    const r = await fetch("/api/senders", { cache: "no-store" });
    const data = await r.json();
    setSenders(data.senders ?? []);
  }
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthErr = params.get("oauth_error");
    if (connected) {
      setFlash({ kind: "ok", msg: `Connected ${connected} via Google OAuth.` });
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
        send_as_email: form.send_as_email.trim() || null,
        ...(isSmtp
          ? {
              provider: "smtp",
              smtp_host: form.smtp_host.trim(),
              smtp_port: form.smtp_port,
              smtp_secure: form.smtp_secure,
              imap_host: form.imap_host.trim(),
              imap_port: form.imap_port,
              imap_secure: form.imap_secure,
            }
          : { provider: "gmail" }),
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
    setForm(EMPTY_FORM);
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
  const [editForm, setEditForm] = useState<{ label: string; from_name: string; send_as_email: string }>({ label: "", from_name: "", send_as_email: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  function startEdit(s: Sender) {
    setEditingId(s.id);
    setEditErr(null);
    setEditForm({ label: s.label, from_name: s.from_name ?? "", send_as_email: s.send_as_email ?? "" });
  }
  async function saveEdit(id: string) {
    setEditSaving(true);
    setEditErr(null);
    const r = await fetch(`/api/senders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: editForm.label,
        from_name: editForm.from_name || null,
        send_as_email: editForm.send_as_email.trim() || null,
      }),
    });
    setEditSaving(false);
    if (!r.ok) {
      setEditErr("Couldn't save — check the send-as alias is a valid email address.");
      return;
    }
    setEditingId(null);
    await load();
  }

  return (
    <AppShell>
      <div className="page-narrow">
        <PageHeader
          eyebrow="Workspace"
          title="Senders"
          subtitle="The inboxes authorized to send your campaigns — Gmail or your own domain. Reputation lives here, not on our infrastructure."
          actions={
            !adding && (
              <>
                <button className="btn-ghost" onClick={() => setAdding("smtp")}>Custom domain</button>
                <button className="btn-ghost" onClick={() => setAdding("gmail")}>Use app password</button>
                <button className="btn-accent" onClick={connectGoogle}>
                  <GoogleGlyph />
                  Connect Gmail
                </button>
              </>
            )
          }
        />

        {flash && <FlashMessage kind={flash.kind} message={flash.msg} onDismiss={() => setFlash(null)} />}

        {adding && (
          <form
            onSubmit={onAdd}
            className="rounded-xl border border-ink-200 bg-paper p-5 sm:p-6 mb-6"
          >
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] mb-1">
              {isSmtp ? "Add sender · custom domain" : "Add sender · app password"}
            </h2>
            {isSmtp ? (
              <div className="mb-5">
                <p className="text-[13px] text-ink-600 mb-4 leading-relaxed">
                  Send from your own domain&rsquo;s mailbox over SMTP, and receive replies over IMAP.
                  Set up SPF, DKIM and DMARC for the domain first or mail will land in spam.
                </p>
                <label className="label-cap">Mail provider</label>
                <select
                  className="field-boxed"
                  value={form.preset}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {Object.entries(PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>{p.name}</option>
                  ))}
                </select>
                {PRESETS[form.preset]?.hint && (
                  <p className="text-[11.5px] text-ink-500 mt-1.5">{PRESETS[form.preset].hint}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <ServerFields
                    title="Outgoing · SMTP"
                    host={form.smtp_host} port={form.smtp_port} secure={form.smtp_secure}
                    ports={[465, 587, 2525]}
                    onChange={(v) => setForm({ ...form, preset: "other", smtp_host: v.host, smtp_port: v.port, smtp_secure: v.secure })}
                  />
                  <ServerFields
                    title="Incoming · IMAP"
                    host={form.imap_host} port={form.imap_port} secure={form.imap_secure}
                    ports={[993, 143]}
                    onChange={(v) => setForm({ ...form, preset: "other", imap_host: v.host, imap_port: v.port, imap_secure: v.secure })}
                  />
                </div>
              </div>
            ) : (
            <p className="text-[13px] text-ink-600 mb-5 leading-relaxed">
              Use an <b className="text-ink">app password</b>, not your Gmail login. Generate at{" "}
              <a
                className="underline decoration-[rgb(255_99_99/0.5)] underline-offset-[3px] hover:text-[rgb(255_140_140)] transition-colors"
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/apppasswords
              </a>. 2FA must be on.
            </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label-cap">Label</label>
                <input
                  className="field-boxed"
                  placeholder="Personal · Work"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label-cap">Display name</label>
                <input
                  className="field-boxed"
                  placeholder="Your full name"
                  value={form.from_name}
                  onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                />
              </div>
              <div>
                <label className="label-cap">{isSmtp ? "Email address" : "Gmail address"}</label>
                <input
                  className="field-boxed"
                  type="email"
                  placeholder={isSmtp ? "you@yourdomain.com" : "you@gmail.com"}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label-cap">{isSmtp ? "Mailbox password" : "App password"}</label>
                <input
                  className="field-boxed font-mono"
                  type={isSmtp ? "password" : "text"}
                  autoComplete={isSmtp ? "new-password" : "off"}
                  placeholder={isSmtp ? "••••••••" : "xxxx xxxx xxxx xxxx"}
                  value={form.app_password}
                  onChange={(e) => setForm({ ...form, app_password: e.target.value })}
                  required
                />
                <p className="text-[11.5px] text-ink-500 mt-1.5">
                  {isSmtp
                    ? "The password for this mailbox. Stored encrypted."
                    : "16 lowercase letters Google generates — not your login password."}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <SendAsField
                value={form.send_as_email}
                onChange={(v) => setForm({ ...form, send_as_email: v })}
              />
            </div>

            <div className="mt-5 space-y-2.5">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                  className="w-4 h-4 accent-accent"
                />
                <span>Make this the default sender for new campaigns</span>
              </label>
              <label className="flex items-start gap-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.warmup_enabled}
                  onChange={(e) => setForm({ ...form, warmup_enabled: e.target.checked })}
                  className="w-4 h-4 mt-0.5 accent-accent"
                />
                <div>
                  <div>Enable 14-day warmup</div>
                  <div className="text-[11.5px] text-ink-500 mt-0.5 leading-relaxed">
                    Ramps from 10/day up to 400/day over 14 days. Brand-new inboxes and domains
                    get flagged fast without it.
                  </div>
                </div>
              </label>
            </div>

            {err && (
              <div
                className="mt-4 px-3 py-2 rounded-lg text-[13px] border flex items-start gap-2"
                style={{
                  borderColor: "rgb(255 99 99 / 0.30)",
                  background: "rgb(255 99 99 / 0.06)",
                  color: "rgb(255 140 140)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>{err}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-ink-100">
              <button
                type="button"
                className="btn-quiet"
                onClick={() => { setAdding(false); setErr(null); }}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-accent">
                {saving ? "Verifying…" : "Add & verify"}
              </button>
            </div>
          </form>
        )}

        {senders === null && <SkeletonList />}

        {senders?.length === 0 && !adding && (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
              </svg>
            }
            title="No senders yet"
            body="Connect a Gmail to start sending campaigns from your own inbox, use an app password if your org blocks OAuth, or add a mailbox on your own domain."
            action={
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <button className="btn-ghost" onClick={() => setAdding("smtp")}>Custom domain</button>
                <button className="btn-ghost" onClick={() => setAdding("gmail")}>Use app password</button>
                <button className="btn-accent" onClick={connectGoogle}>
                  <GoogleGlyph />
                  Connect Gmail
                </button>
              </div>
            }
          />
        )}

        {senders && senders.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
            {senders.map((s, i) => (
              <div
                key={s.id}
                className={i < senders.length - 1 ? "border-b border-ink-100" : ""}
              >
                {editingId === s.id ? (
                  <div className="px-4 sm:px-5 py-4 bg-surface space-y-3">
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
                    <SendAsField
                      value={editForm.send_as_email}
                      onChange={(v) => setEditForm({ ...editForm, send_as_email: v })}
                    />
                    {editErr && <div className="text-[12px] text-[rgb(255_140_140)]">{editErr}</div>}
                    <div className="text-[12px] text-ink-500">
                      Email <span className="font-mono text-ink-700">{s.email}</span> can&rsquo;t be changed.
                      Delete and re-add to switch accounts.
                    </div>
                    <div className="flex justify-end gap-2">
                      <button className="btn-quiet text-[12.5px]" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn-accent text-[12.5px]"
                        disabled={editSaving || !editForm.label.trim()}
                        onClick={() => saveEdit(s.id)}
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <SenderRow
                    sender={s}
                    onConnect={connectGoogle}
                    onEdit={() => startEdit(s)}
                    onSetDefault={() => setDefault(s.id)}
                    onDelete={() => remove(s.id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ----------------------------------------------------------------------- */

function SenderRow({
  sender,
  onConnect,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  sender: Sender;
  onConnect: () => void;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const w = warmupStatus(sender);
  const isOauth = sender.auth_method === "oauth";
  const isRevoked = isOauth && sender.oauth_status === "revoked";
  const [dnsReport, setDnsReport] = useState<DnsReport | null>(null);
  const [dnsOpen, setDnsOpen] = useState(false);
  const [dnsBusy, setDnsBusy] = useState(false);

  async function checkDns() {
    if (dnsOpen && dnsReport) { setDnsOpen(false); return; }
    setDnsOpen(true);
    setDnsBusy(true);
    try {
      const r = await fetch(`/api/senders/${sender.id}/dns`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setDnsReport(d.report ?? null);
    } finally {
      setDnsBusy(false);
    }
  }

  return (
    <div>
    <div className="group flex items-center justify-between gap-4 px-4 sm:px-5 py-4 hover:bg-hover transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Avatar */}
        <span
          className="grid place-items-center w-9 h-9 rounded-lg shrink-0"
          style={{
            background: isRevoked
              ? "rgb(239 68 68 / 0.10)"
              : isOauth
                ? "rgb(16 185 129 / 0.10)"
                : "rgb(255 159 67 / 0.10)",
            color: isRevoked
              ? "rgb(252 165 165)"
              : isOauth
                ? "rgb(110 231 183)"
                : "rgb(255 180 110)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] font-medium text-ink truncate">{sender.label}</span>
            {sender.is_default && (
              <Tag tone="hot">default</Tag>
            )}
            {isOauth ? (
              <Tag tone="ok">OAuth</Tag>
            ) : sender.provider === "smtp" ? (
              <Tag tone="ok">{sender.smtp_host ? `smtp · ${sender.smtp_host}` : "smtp"}</Tag>
            ) : (
              <Tag tone="warn">app pw</Tag>
            )}
            {isRevoked && <Tag tone="bad">revoked</Tag>}
            {w && (w.done ? <Tag tone="ok">warmup done</Tag> : <Tag tone="warn">warmup d{w.day}/14 · {w.cap}/d</Tag>)}
          </div>
          <div className="text-[13px] text-ink-600 truncate mt-0.5">
            {sender.from_name ? (
              <>
                {sender.from_name}
                <span className="text-ink-400 font-mono"> &lt;{sender.email}&gt;</span>
              </>
            ) : (
              <span className="font-mono text-ink-500">{sender.email}</span>
            )}
          </div>
          {sender.send_as_email && (
            <div className="text-[12px] text-ink-500 truncate mt-0.5">
              sends as <span className="font-mono text-ink-700">{sender.send_as_email}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isRevoked && (
          <button className="btn-accent text-[12.5px] py-1.5 px-3" onClick={onConnect}>
            Reconnect
          </button>
        )}
        <button className="btn-quiet text-[12.5px]" onClick={checkDns} title="Check SPF, DKIM and DMARC for this sender's domain">
          {dnsOpen && dnsReport ? "Hide DNS" : "Check DNS"}
        </button>
        <button className="btn-quiet text-[12.5px]" onClick={onEdit}>Edit</button>
        {!sender.is_default && (
          <button className="btn-quiet text-[12.5px]" onClick={onSetDefault}>
            Set default
          </button>
        )}
        <button
          className="btn-quiet text-[12.5px] text-[rgb(252_165_165)] hover:text-[rgb(255_140_140)]"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
    {dnsOpen && (
      <div className="px-4 sm:px-5 pb-4 -mt-1">
        {dnsBusy ? (
          <div className="text-[12.5px] text-ink-500">Checking DNS…</div>
        ) : !dnsReport ? (
          <div className="text-[12.5px] text-[rgb(252_165_165)]">Couldn&rsquo;t check DNS. Try again.</div>
        ) : dnsReport.managed ? (
          <div className="text-[12.5px] text-ink-500">
            <span className="font-mono">{dnsReport.domain}</span> is a free-mail domain; authentication is handled by the provider.
            Free inboxes have low limits (Gmail: 500/day) and weaker cold-email reputation. A custom domain on Google Workspace is better for outreach.
          </div>
        ) : (
          <div className="rounded-lg border border-ink-200 divide-y divide-ink-100 text-[12.5px]">
            <div className="px-3 py-2 flex items-center gap-2">
              <span className="font-mono">{dnsReport.domain}</span>
              <DnsTag status={dnsReport.score} />
              {dnsReport.score === "fail" && (
                <span className="text-ink-500">Gmail and Outlook may reject mail from this domain until this is fixed.</span>
              )}
            </div>
            {([
              ["SPF", dnsReport.spf.status, dnsReport.spf.note],
              ["DKIM", dnsReport.dkim.status, dnsReport.dkim.note],
              ["DMARC", dnsReport.dmarc.status, dnsReport.dmarc.note],
              ["MX", dnsReport.mx.status, dnsReport.mx.hosts.length ? dnsReport.mx.hosts.slice(0, 2).join(", ") : "No MX records: replies to this domain can't be delivered."],
            ] as const).map(([k, st, note]) => (
              <div key={k} className="px-3 py-2 grid grid-cols-[56px,52px,1fr] gap-2 items-start">
                <span className="font-medium">{k}</span>
                <DnsTag status={st} />
                <span className="text-ink-600 break-words">{note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )}
    </div>
  );
}

type DnsStatus = "pass" | "warn" | "fail";
type DnsReport = {
  domain: string;
  managed: boolean;
  score: DnsStatus;
  mx: { status: DnsStatus; hosts: string[] };
  spf: { status: DnsStatus; note: string };
  dkim: { status: DnsStatus; note: string };
  dmarc: { status: DnsStatus; note: string };
};

function DnsTag({ status }: { status: DnsStatus }) {
  return <Tag tone={status === "pass" ? "ok" : status === "warn" ? "warn" : "bad"}>{status}</Tag>;
}

function SendAsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label-cap">Send as (alias) · optional</label>
      <input
        className="field-boxed"
        type="email"
        placeholder="hello@yourdomain.com"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[11.5px] text-ink-500 mt-1.5 leading-relaxed">
        Recipients see this address in From and Reply-To. Add it first in Gmail → Settings →
        Accounts → &ldquo;Send mail as&rdquo;, or Gmail will send from the mailbox address instead.
      </p>
    </div>
  );
}

function ServerFields({
  title, host, port, secure, ports, onChange,
}: {
  title: string;
  host: string;
  port: number;
  secure: boolean;
  ports: number[];
  onChange: (v: { host: string; port: number; secure: boolean }) => void;
}) {
  return (
    <div className="rounded-lg border border-ink-100 p-3 space-y-2.5">
      <div className="label-cap">{title}</div>
      <input
        className="field-boxed font-mono"
        placeholder="mail.example.com"
        value={host}
        onChange={(e) => onChange({ host: e.target.value, port, secure })}
        required
      />
      <div className="flex items-center gap-3">
        <select
          className="field-boxed w-28"
          value={port}
          // Implicit-TLS ports (465/993) are secure; the others upgrade via STARTTLS.
          onChange={(e) => {
            const p = Number(e.target.value);
            onChange({ host, port: p, secure: p === 465 || p === 993 });
          }}
        >
          {ports.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-[11.5px] text-ink-500">{secure ? "SSL/TLS" : "STARTTLS"}</span>
      </div>
    </div>
  );
}

function Tag({ tone, children }: { tone: "ok" | "warn" | "bad" | "hot"; children: React.ReactNode }) {
  const styles = {
    ok:   { bg: "rgb(16 185 129 / 0.10)", text: "rgb(110 231 183)" },
    warn: { bg: "rgb(255 159 67 / 0.10)", text: "rgb(255 180 110)" },
    bad:  { bg: "rgb(239 68 68 / 0.10)",  text: "rgb(252 165 165)" },
    hot:  { bg: "rgb(255 99 99 / 0.10)",  text: "rgb(255 140 140)" },
  } as const;
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.text }}
    >
      {children}
    </span>
  );
}

function FlashMessage({
  kind, message, onDismiss,
}: {
  kind: "ok" | "err";
  message: string;
  onDismiss: () => void;
}) {
  const tone = kind === "ok"
    ? { border: "rgb(16 185 129 / 0.30)", bg: "rgb(16 185 129 / 0.08)", text: "rgb(110 231 183)", iconBg: "rgb(16 185 129 / 0.18)" }
    : { border: "rgb(255 99 99 / 0.30)", bg: "rgb(255 99 99 / 0.06)", text: "rgb(255 140 140)", iconBg: "rgb(255 99 99 / 0.18)" };
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl border mb-6"
      style={{ borderColor: tone.border, background: tone.bg }}
    >
      <span
        className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
        style={{ background: tone.iconBg, color: tone.text }}
        aria-hidden
      >
        {kind === "ok" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4M12 16h.01" />
          </svg>
        )}
      </span>
      <span className="flex-1 text-[13.5px] text-ink">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid place-items-center w-6 h-6 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 3l6 6M3 9l6-6" />
        </svg>
      </button>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-5 py-4 ${i < 2 ? "border-b border-ink-100" : ""}`}
        >
          <div className="w-9 h-9 rounded-lg bg-ink-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-ink-100 animate-pulse" />
            <div className="h-2.5 w-2/3 rounded bg-ink-100 animate-pulse" />
          </div>
          <div className="h-7 w-16 rounded bg-ink-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.4-11.3-8l-6.5 5C9.6 39.7 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.6l6.2 5.2C40.7 36 44 30.4 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
