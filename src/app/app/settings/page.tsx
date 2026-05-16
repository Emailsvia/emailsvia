"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";

type Settings = {
  tracking_enabled_default: boolean;
  poll_replies: boolean;
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

  async function patch(field: keyof Settings, value: boolean) {
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
        <PageHeader eyebrow="Settings" title="Tracking" />

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
              description="When on, we poll your connected Gmail inboxes every 5 minutes and mark recipients as replied when they answer. This is the heaviest knob — leave it off if you don't watch replies inside EmailsVia."
              checked={settings.poll_replies}
              saving={saving === "poll_replies"}
              onChange={(v) => patch("poll_replies", v)}
            />
          </div>
        )}
      </div>
    </AppShell>
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
