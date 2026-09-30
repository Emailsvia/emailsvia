"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";

type Settings = {
  tracking_enabled_default: boolean;
  poll_replies: boolean;
  meeting_link: string | null;
  notify_interested: boolean;
  meetings_token: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<keyof Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSettings(d))
      .catch(() => setErr("Failed to load settings."));
  }, []);

  const [meetingLink, setMeetingLink] = useState("");
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  useEffect(() => { if (settings) setMeetingLink(settings.meeting_link ?? ""); }, [settings?.meeting_link]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveMeetingLink() {
    setLinkMsg(null);
    const r = await fetch("/api/app/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meeting_link: meetingLink.trim() || null }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setLinkMsg(d.error ?? "Couldn't save."); return; }
    setSettings(d as Settings);
    setLinkMsg("Saved");
  }

  async function patch(field: "tracking_enabled_default" | "poll_replies" | "notify_interested", value: boolean) {
    if (!settings) return;
    setSaving(field);
    setErr(null);
    const prev = settings;
    setSettings({ ...settings, [field]: value });
    try {
      const r = await fetch("/api/app/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) throw new Error(await r.text());
      const next = (await r.json()) as Settings;
      setSettings(next);
    } catch {
      setSettings(prev);
      setErr("Couldn't save — try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <PageHeader eyebrow="Settings" title="Preferences" />

        <p className="text-[13px] text-ink-500 mb-6">
          Tracking is off by default. Each switch only affects new activity —
          existing campaigns keep whatever they were set to.
        </p>

        {err && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {err}
          </div>
        )}

        {!settings ? (
          <div className="sheet p-5 text-[13px] text-ink-500">Loading…</div>
        ) : (
          <div className="space-y-3">
            <ToggleRow
              title="Open &amp; click tracking"
              description="When on, new campaigns are created with the tracking pixel and link rewrites enabled. You can still flip the per-campaign switch on each campaign. Off saves bandwidth and avoids the Gmail image proxy quirks."
              checked={settings.tracking_enabled_default}
              saving={saving === "tracking_enabled_default"}
              onChange={(v) => patch("tracking_enabled_default", v)}
            />
            <ToggleRow
              title="Reply detection"
              description="When on, we poll your connected inboxes every 5 minutes so replies show up in EmailsVia and get AI labels. Follow-ups are safe either way: before every follow-up we check that inbox for a reply, bounce or out-of-office first."
              checked={settings.poll_replies}
              saving={saving === "poll_replies"}
              onChange={(v) => patch("poll_replies", v)}
            />
            <ToggleRow
              title="Email me when someone is interested"
              description="When AI labels a reply as interested, we email you right away with a preview and a link to answer. Replying within minutes is the biggest lever on booked meetings."
              checked={settings.notify_interested}
              saving={saving === "notify_interested"}
              onChange={(v) => patch("notify_interested", v)}
            />
            <div className="sheet p-5">
              <label className="text-[14px] font-semibold" htmlFor="meeting-link">Meeting link</label>
              <div className="mt-1 text-[12px] text-ink-500">
                Your Calendly / Cal.com / Google booking page. AI reply drafts offer it when a prospect wants to talk.
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <input
                  id="meeting-link"
                  type="url"
                  className="field-boxed flex-1 text-[13px]"
                  placeholder="https://cal.com/you/15min"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                />
                <button type="button" className="btn-ghost text-[13px]" onClick={saveMeetingLink}>Save</button>
              </div>
              {linkMsg && <div className="text-[12px] text-ink-500 mt-2">{linkMsg}</div>}
            </div>
            <MeetingWebhook token={settings.meetings_token} onChange={(next) => setSettings(next)} />
          </div>
        )}

        <IntegrationsSection />

        <SuppressionList />
      </div>
    </AppShell>
  );
}

// Booking webhook: a new booking stops that person's follow-ups everywhere.
function MeetingWebhook({ token, onChange }: { token: string | null; onChange: (s: Settings) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/api/inbound/meetings/${token}` : null;

  async function set(value: "regenerate" | null) {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/app/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetings_token: value }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Couldn't save."); return; }
    onChange(d as Settings);
    setMsg(value ? "New URL created. Update it in your scheduler." : "Turned off.");
  }

  return (
    <div className="sheet p-5">
      <div className="text-[14px] font-semibold">Meeting bookings</div>
      <div className="mt-1 text-[12px] text-ink-500">
        When a prospect books a meeting, EmailsVia stops following up with them (and their colleagues, if the campaign
        stops the whole company), cancels anything scheduled, and logs it. Add this URL as a webhook in your scheduler:
        Cal.com: Settings → Developer → Webhooks → &quot;Booking created&quot;. Calendly: an <code>invitee.created</code>{" "}
        webhook subscription. Anything else (Zapier, Make): POST JSON <code>{"{\"email\": \"…\"}"}</code>.
      </div>
      {url ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input readOnly className="field-boxed flex-1 text-[12px] font-mono" value={url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-ghost text-[13px]" onClick={() => { navigator.clipboard?.writeText(url); setMsg("Copied"); }}>Copy</button>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <button type="button" className="btn-quiet text-xs" disabled={busy} onClick={() => set("regenerate")}>Replace URL</button>
            <button type="button" className="btn-quiet text-xs" disabled={busy} onClick={() => set(null)}>Turn off</button>
            <span className="text-ink-500">Keep it private: anyone with it can mark meetings as booked.</span>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-ghost text-[13px] mt-3" disabled={busy} onClick={() => set("regenerate")}>
          Create webhook URL
        </button>
      )}
      {msg && <div className="text-[12px] text-ink-500 mt-2">{msg}</div>}
    </div>
  );
}

type Suppression = { kind: "email" | "domain"; value: string; reason: string; created_at: string };

const REASON_LABEL: Record<string, string> = {
  bounced: "bounced",
  manual: "added by you",
  not_interested: "not interested",
  import: "imported",
};

function SuppressionList() {
  const [items, setItems] = useState<Suppression[] | null>(null);
  const [entries, setEntries] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/suppressions", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setItems(d.suppressions ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error ?? "Couldn't add those.");
      } else {
        setEntries("");
        setMsg(
          `Added ${d.added}.` +
            (d.invalid?.length ? ` Skipped ${d.invalid.length} that weren't emails or domains.` : "")
        );
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Suppression) {
    const qs = new URLSearchParams({ kind: s.kind, value: s.value });
    const r = await fetch(`/api/suppressions?${qs}`, { method: "DELETE" });
    if (r.ok) setItems((prev) => (prev ?? []).filter((x) => !(x.kind === s.kind && x.value === s.value)));
  }

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold">Do-not-contact list</h2>
      <p className="text-[13px] text-ink-500 mt-1 mb-4">
        Nobody on this list gets an email from any campaign. Add an address, or a whole domain
        (like <span className="font-mono">yourcustomer.com</span>) to skip everyone there.
        Hard bounces are added automatically.
      </p>
      <div className="sheet p-5">
        <label className="label-cap" htmlFor="suppress-entries">Emails or domains, one per line</label>
        <textarea
          id="suppress-entries"
          className="field-boxed w-full min-h-[90px] font-mono text-[12.5px]"
          placeholder={"jane@acme.com\ncompetitor.com"}
          value={entries}
          onChange={(e) => setEntries(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-3">
          <button type="button" className="btn-accent text-[13px]" disabled={busy || !entries.trim()} onClick={add}>
            {busy ? "Adding…" : "Add to list"}
          </button>
          {msg && <span className="text-[12px] text-ink-500">{msg}</span>}
        </div>
      </div>

      <div className="sheet mt-3 divide-y divide-ink-100">
        {items === null ? (
          <div className="p-4 text-[13px] text-ink-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-500">Nothing on the list yet.</div>
        ) : (
          items.map((s) => (
            <div key={`${s.kind}:${s.value}`} className="px-4 py-2.5 flex items-center gap-3 text-[13px]">
              <span className="pill-draft text-[11px] shrink-0">{s.kind}</span>
              <span className="font-mono text-[12.5px] truncate flex-1 min-w-0">{s.value}</span>
              <span className="text-[11px] text-ink-500 shrink-0 hidden sm:inline">{REASON_LABEL[s.reason] ?? s.reason}</span>
              <button type="button" className="btn-quiet text-[12px] shrink-0" onClick={() => remove(s)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  saving,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="sheet p-5 flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1 w-4 h-4 accent-accent shrink-0"
        checked={checked}
        disabled={saving}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-[14px] font-semibold">{title}</div>
          {saving && <span className="text-[11px] text-ink-500">saving…</span>}
        </div>
        <div className="mt-1 text-[12px] text-ink-500">{description}</div>
      </div>
    </label>
  );
}

type IntegrationRow = {
  provider: "hubspot" | "pipedrive" | "slack";
  push_intents: string[];
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
};

const PROVIDER_INFO: Record<IntegrationRow["provider"], { name: string; field: string; placeholder: string; help: string }> = {
  hubspot: {
    name: "HubSpot",
    field: "Private app access token",
    placeholder: "pat-na1-…",
    help: "HubSpot → Settings → Integrations → Private apps → Create. Scopes: crm.objects.contacts.read + write. We create or update the contact and attach the reply as a note.",
  },
  pipedrive: {
    name: "Pipedrive",
    field: "Personal API token",
    placeholder: "40-character token",
    help: "Pipedrive → Personal preferences → API. We create or update the person, attach the reply as a note, and open a lead for interested replies.",
  },
  slack: {
    name: "Slack",
    field: "Incoming webhook URL",
    placeholder: "https://hooks.slack.com/services/…",
    help: "Slack → Apps → Incoming Webhooks → Add to a channel. We post each matching reply with a link to answer it.",
  },
};

const PUSHABLE_INTENTS: Array<{ id: string; label: string }> = [
  { id: "interested", label: "Interested" },
  { id: "question", label: "Question" },
  { id: "not_now", label: "Not now" },
  { id: "unsubscribe", label: "Unsubscribe" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "other", label: "Other" },
];

function IntegrationsSection() {
  const [rows, setRows] = useState<IntegrationRow[] | null>(null);
  async function load() {
    const r = await fetch("/api/integrations", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setRows(d.integrations ?? []);
  }
  useEffect(() => { load(); }, []);

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold">Integrations</h2>
      <p className="text-[13px] text-ink-500 mt-1 mb-4">
        Send labelled replies to your CRM or a Slack channel automatically (Growth &amp; Scale). For anything else,
        use <a href="/app/webhooks" className="underline">Webhooks</a> with Zapier or Make.
      </p>
      <div className="space-y-3">
        {(Object.keys(PROVIDER_INFO) as IntegrationRow["provider"][]).map((p) => (
          <IntegrationCard key={p} provider={p} row={rows?.find((r) => r.provider === p) ?? null} onChange={load} />
        ))}
      </div>
    </section>
  );
}

function IntegrationCard({
  provider, row, onChange,
}: {
  provider: IntegrationRow["provider"];
  row: IntegrationRow | null;
  onChange: () => void;
}) {
  const info = PROVIDER_INFO[provider];
  const [secret, setSecret] = useState("");
  const [intents, setIntents] = useState<string[]>(row?.push_intents ?? ["interested"]);
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (row) setIntents(row.push_intents); }, [row?.push_intents?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function call(kind: "save" | "test" | "remove") {
    setBusy(kind);
    setMsg(null);
    try {
      const r =
        kind === "save"
          ? await fetch("/api/integrations", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ provider, ...(secret.trim() ? { secret: secret.trim() } : {}), push_intents: intents, active: true }),
            })
          : kind === "test"
            ? await fetch("/api/integrations/test", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ provider }),
              })
            : await fetch(`/api/integrations?provider=${provider}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Something went wrong.");
      setMsg({ ok: true, text: kind === "save" ? "Saved." : kind === "test" ? `Test sent. Check ${info.name}.` : "Disconnected." });
      if (kind === "save") setSecret("");
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{info.name}</span>
          {row ? <span className="pill-live">connected</span> : <span className="pill-draft">not connected</span>}
        </div>
        {row && (
          <div className="flex items-center gap-1">
            <button type="button" className="btn-quiet text-[12.5px]" disabled={busy !== null} onClick={() => call("test")}>
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
            <button type="button" className="btn-quiet text-[12.5px] text-[rgb(252_165_165)]" disabled={busy !== null} onClick={() => call("remove")}>
              Disconnect
            </button>
          </div>
        )}
      </div>
      <p className="text-[12px] text-ink-500 mt-1">{info.help}</p>
      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          type="password"
          autoComplete="off"
          className="field-boxed flex-1 text-[13px] font-mono"
          placeholder={row ? "Stored. Paste a new one to replace it" : info.placeholder}
          aria-label={info.field}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button type="button" className="btn-ghost text-[13px]" disabled={busy !== null || (!row && !secret.trim())} onClick={() => call("save")}>
          {busy === "save" ? "Saving…" : row ? "Save" : "Connect"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <span className="text-[12px] text-ink-500 mr-1">Push replies labelled</span>
        {PUSHABLE_INTENTS.map((i) => {
          const on = intents.includes(i.id);
          return (
            <button
              key={i.id}
              type="button"
              aria-pressed={on}
              onClick={() => setIntents(on ? intents.filter((x) => x !== i.id) : [...intents, i.id])}
              className={"text-[12px] px-2 py-0.5 rounded border " + (on ? "bg-ink text-paper border-ink" : "bg-surface text-ink-700 border-ink-200")}
            >
              {i.label}
            </button>
          );
        })}
      </div>
      {row?.last_error && <p className="text-[12px] mt-2 text-[rgb(252_165_165)]">Last error: {row.last_error}</p>}
      {row?.last_synced_at && !row.last_error && (
        <p className="text-[12px] mt-2 text-ink-500">Last synced {new Date(row.last_synced_at).toLocaleString()}</p>
      )}
      {msg && <p className="text-[12px] mt-2" style={{ color: msg.ok ? "rgb(110 231 183)" : "rgb(252 165 165)" }}>{msg.text}</p>}
    </div>
  );
}
