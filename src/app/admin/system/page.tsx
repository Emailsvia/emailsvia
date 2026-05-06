"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SystemData = {
  locks: Array<{ key: string; acquired_at: string; expires_at: string }>;
  last_send_at: string | null;
  sends_1h: number;
  errors_1h: number;
  pending_deliveries: number;
  env: {
    has_postmark: boolean;
    has_stripe: boolean;
    has_sentry: boolean;
    has_cron_secret: boolean;
    has_oauth: boolean;
    has_encryption: boolean;
    app_url: string | null;
  };
  ai: {
    active: "anthropic" | "gemini" | "groq" | null;
    available: Array<"anthropic" | "gemini" | "groq">;
    triage_model: string | null;
    generate_model: string | null;
  };
  audit: Array<{
    id: number;
    action: string;
    target_type: string | null;
    target_id: string | null;
    actor_id: string;
    payload: unknown;
    created_at: string;
  }>;
};

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/system", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }
  useEffect(load, []);

  async function trigger(target: "tick" | "check-replies") {
    if (!confirm(`Manually run /api/${target} now?`)) return;
    setBusy(true);
    setOutput(null);
    const res = await fetch("/api/admin/cron/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const j = await res.json();
    setOutput(JSON.stringify(j, null, 2));
    setBusy(false);
    load();
  }

  if (!data) {
    return (
      <div className="page-narrow">
        <h1 className="text-[28px] font-bold tracking-tight">System</h1>
        <p className="text-[13px] text-ink-500 mt-2">Loading…</p>
      </div>
    );
  }

  const errRate1h =
    data.sends_1h + data.errors_1h > 0
      ? data.errors_1h / (data.sends_1h + data.errors_1h)
      : 0;

  return (
    <div className="page-narrow">
      <h1 className="text-[28px] font-bold tracking-tight">System</h1>
      <p className="text-[13px] text-ink-500 mt-1">
        Cron lease state, environment, and manual triggers.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <Stat label="Sends · 1h" value={data.sends_1h.toLocaleString()} />
        <Stat
          label="Error rate · 1h"
          value={`${(errRate1h * 100).toFixed(1)}%`}
          tone={errRate1h > 0.05 ? "warn" : undefined}
        />
        <Stat
          label="Pending webhooks"
          value={data.pending_deliveries.toLocaleString()}
          tone={data.pending_deliveries > 50 ? "warn" : undefined}
        />
        <Stat
          label="Last send"
          value={
            data.last_send_at
              ? new Date(data.last_send_at).toLocaleTimeString()
              : "never"
          }
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="sheet p-4">
          <h2 className="text-[14px] font-semibold mb-3">Cron leases</h2>
          {data.locks.length === 0 ? (
            <p className="text-[13px] text-ink-500">No active leases (cron is idle).</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[12px] text-ink-500 text-left">
                  <th className="py-1 font-medium">Key</th>
                  <th className="py-1 font-medium">Acquired</th>
                  <th className="py-1 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.locks.map((l) => (
                  <tr key={l.key} className="border-t border-ink-100">
                    <td className="py-1 font-mono text-[11px]">{l.key}</td>
                    <td className="py-1 text-[11px] text-ink-500">
                      {new Date(l.acquired_at).toLocaleTimeString()}
                    </td>
                    <td className="py-1 text-[11px] text-ink-500">
                      {new Date(l.expires_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => trigger("tick")}
              className="btn-quiet text-[12px]"
            >
              Run /api/tick
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => trigger("check-replies")}
              className="btn-quiet text-[12px]"
            >
              Run /api/check-replies
            </button>
          </div>
          {output && (
            <pre className="mt-3 text-[11px] bg-paper border border-ink-100 rounded p-2 overflow-x-auto max-h-60">
              {output}
            </pre>
          )}
        </div>

        <div className="sheet p-4">
          <h2 className="text-[14px] font-semibold mb-3">Environment</h2>
          <ul className="text-[13px] space-y-1.5">
            <EnvLine ok={data.env.has_encryption} label="ENCRYPTION_SECRET" />
            <EnvLine ok={data.env.has_cron_secret} label="CRON_SECRET" />
            <EnvLine ok={data.env.has_stripe} label="Stripe" />
            <EnvLine ok={data.env.has_oauth} label="Google OAuth" />
            <EnvLine ok={data.env.has_postmark} label="Postmark (transactional)" />
            <EnvLine ok={data.env.has_sentry} label="Sentry" />
            <li className="flex items-center justify-between">
              <span className="text-ink-500">APP_URL</span>
              <span className="font-mono text-[11px] truncate max-w-[200px]">
                {data.env.app_url ?? "—"}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">AI provider</h2>
        {!data.ai.active ? (
          <p className="text-[13px] text-ink-500">
            No AI provider configured. Reply triage and{" "}
            <code className="text-[11px]">{`{{ai:...}}`}</code> personalization are
            inactive. Set <code>GROQ_API_KEY</code>, <code>GEMINI_API_KEY</code>, or{" "}
            <code>ANTHROPIC_API_KEY</code> to enable.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Active</span>
              <span className="capitalize text-emerald-700">{data.ai.active}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Available keys</span>
              <span className="font-mono text-[11px]">
                {data.ai.available.length > 0
                  ? data.ai.available.join(" · ")
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Triage model</span>
              <span className="font-mono text-[11px] truncate">
                {data.ai.triage_model ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Generate model</span>
              <span className="font-mono text-[11px] truncate">
                {data.ai.generate_model ?? "—"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="sheet p-4 mt-3">
        <h2 className="text-[14px] font-semibold mb-3">Recent operator actions</h2>
        {data.audit.length === 0 ? (
          <p className="text-[13px] text-ink-500">No operator actions logged yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[12px] text-ink-500 text-left">
                <th className="py-1.5 font-medium">Action</th>
                <th className="py-1.5 font-medium">Target</th>
                <th className="py-1.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id} className="border-t border-ink-100">
                  <td className="py-1.5 font-mono text-[12px]">{a.action}</td>
                  <td className="py-1.5 text-[12px]">
                    {a.target_type === "user" && a.target_id ? (
                      <Link
                        className="hover:underline font-mono text-[11px]"
                        href={`/admin/users/${a.target_id}`}
                      >
                        {a.target_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-[11px] text-ink-500">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EnvLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span className={ok ? "text-emerald-700" : "text-amber-700"}>
        {ok ? "configured" : "missing"}
      </span>
    </li>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="sheet p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div
        className={
          "text-[18px] font-bold mt-1 " + (tone === "warn" ? "text-red-600" : "text-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
