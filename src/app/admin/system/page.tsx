"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import KpiCard from "@/components/app/KpiCard";
import CodeBlock from "@/components/app/CodeBlock";

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
      <div className="page">
        <PageHeader eyebrow="Operator" title="System" />
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-56 rounded-xl bg-ink-100 animate-pulse" />
            <div className="h-56 rounded-xl bg-ink-100 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const errRate1h =
    data.sends_1h + data.errors_1h > 0
      ? data.errors_1h / (data.sends_1h + data.errors_1h)
      : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operator"
        title="System"
        subtitle="Cron lease state, environment, AI provider, and manual triggers."
      />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Sends · 1h" value={data.sends_1h.toLocaleString()} />
        <KpiCard
          label="Error rate · 1h"
          value={`${(errRate1h * 100).toFixed(1)}%`}
          tone={errRate1h > 0.05 ? "hot" : "default"}
        />
        <KpiCard
          label="Pending webhooks"
          value={data.pending_deliveries.toLocaleString()}
          tone={data.pending_deliveries > 50 ? "hot" : "default"}
        />
        <KpiCard
          label="Last send"
          value={data.last_send_at ? new Date(data.last_send_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "never"}
        />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel title="Cron leases">
          {data.locks.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-[13px] text-[rgb(110_231_183)]">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "rgb(16 185 129)", boxShadow: "0 0 8px rgb(16 185 129 / 0.5)" }}
              />
              No active leases (cron is idle).
            </div>
          ) : (
            <div className="rounded-lg border border-ink-100 overflow-hidden mb-4">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left bg-surface border-b border-ink-100">
                    <ColHead>Key</ColHead>
                    <ColHead>Acquired</ColHead>
                    <ColHead>Expires</ColHead>
                  </tr>
                </thead>
                <tbody>
                  {data.locks.map((l, i) => (
                    <tr
                      key={l.key}
                      className={i < data.locks.length - 1 ? "border-b border-ink-100" : ""}
                    >
                      <td className="py-2 px-3 font-mono text-[12px] text-ink">{l.key}</td>
                      <td className="py-2 px-3 font-mono text-[11.5px] text-ink-500">{new Date(l.acquired_at).toLocaleTimeString()}</td>
                      <td className="py-2 px-3 font-mono text-[11.5px] text-ink-500">{new Date(l.expires_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2 flex-wrap mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => trigger("tick")}
              className="btn-quiet text-[12.5px]"
            >
              Run /api/tick
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => trigger("check-replies")}
              className="btn-quiet text-[12.5px]"
            >
              Run /api/check-replies
            </button>
          </div>
          {output && (
            <div className="mt-3">
              <CodeBlock language="json">{output}</CodeBlock>
            </div>
          )}
        </Panel>

        <Panel title="Environment">
          <div className="space-y-1.5">
            <EnvLine ok={data.env.has_encryption} label="ENCRYPTION_SECRET" />
            <EnvLine ok={data.env.has_cron_secret} label="CRON_SECRET" />
            <EnvLine ok={data.env.has_stripe} label="Stripe" />
            <EnvLine ok={data.env.has_oauth} label="Google OAuth" />
            <EnvLine ok={data.env.has_postmark} label="Postmark (transactional)" />
            <EnvLine ok={data.env.has_sentry} label="Sentry" />
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[13px] text-ink-700">APP_URL</span>
              <span className="font-mono text-[11.5px] text-ink-500 truncate max-w-[220px]">
                {data.env.app_url ?? "—"}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="AI provider" className="mt-3">
        {!data.ai.active ? (
          <div
            className="px-3 py-3 rounded-lg border text-[13px]"
            style={{
              borderColor: "rgb(255 159 67 / 0.30)",
              background: "rgb(255 159 67 / 0.06)",
              color: "rgb(244 244 245)",
            }}
          >
            No AI provider configured. Reply triage and{" "}
            <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded text-ink">{`{{ai:...}}`}</code>{" "}
            personalization are inactive. Set{" "}
            <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded text-ink">GROQ_API_KEY</code>,{" "}
            <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded text-ink">GEMINI_API_KEY</code>, or{" "}
            <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded text-ink">ANTHROPIC_API_KEY</code> to enable.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <KV label="Active">
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: "rgb(16 185 129 / 0.10)", color: "rgb(110 231 183)" }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: "rgb(16 185 129)", boxShadow: "0 0 6px rgb(16 185 129 / 0.6)" }}
                />
                {data.ai.active}
              </span>
            </KV>
            <KV label="Available keys">
              <span className="font-mono text-[12px] text-ink-700">
                {data.ai.available.length > 0 ? data.ai.available.join(" · ") : "—"}
              </span>
            </KV>
            <KV label="Triage model">
              <span className="font-mono text-[12px] text-ink-700 truncate">
                {data.ai.triage_model ?? "—"}
              </span>
            </KV>
            <KV label="Generate model">
              <span className="font-mono text-[12px] text-ink-700 truncate">
                {data.ai.generate_model ?? "—"}
              </span>
            </KV>
          </div>
        )}
      </Panel>

      <Panel title="Recent operator actions" className="mt-3">
        {data.audit.length === 0 ? (
          <p className="text-[13px] text-ink-500">No operator actions logged yet.</p>
        ) : (
          <div className="space-y-1">
            {data.audit.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-[auto,1fr,auto] items-baseline gap-3 py-1.5 px-2 rounded hover:bg-hover transition-colors"
              >
                <code className="font-mono text-[12px] text-ink">{a.action}</code>
                <span className="font-mono text-[11.5px] text-ink-500 truncate">
                  {a.target_type === "user" && a.target_id ? (
                    <Link
                      href={`/admin/users/${a.target_id}`}
                      className="text-ink hover:text-[rgb(255_140_140)] transition-colors"
                    >
                      user · {a.target_id.slice(0, 8)}…
                    </Link>
                  ) : a.payload ? (
                    JSON.stringify(a.payload)
                  ) : (
                    "—"
                  )}
                </span>
                <span className="font-mono text-[11.5px] text-ink-500 shrink-0">
                  {new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function EnvLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-ink-700">{label}</span>
      {ok ? (
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: "rgb(16 185 129 / 0.10)", color: "rgb(110 231 183)" }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "rgb(16 185 129)" }} />
          configured
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: "rgb(255 159 67 / 0.10)", color: "rgb(255 180 110)" }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "rgb(255 159 67)" }} />
          missing
        </span>
      )}
    </div>
  );
}

function Panel({
  title, children, className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-ink-200 bg-paper p-4 sm:p-5 ${className}`}>
      <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink mb-4">{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] text-ink-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 font-medium py-2 px-3 text-left">
      {children}
    </th>
  );
}
