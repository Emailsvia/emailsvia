"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/app/PageHeader";
import EmptyState from "@/components/app/EmptyState";
import BodyEditor from "@/components/BodyEditor";
import { SITUATIONS, SITUATION_BY_KEY, type SituationKey } from "@/lib/situations";
import { TEMPLATE_PACK, isPackReady } from "@/lib/template-pack";

// Reusable follow-up emails. Tag a template with the situations it's written
// for ("didn't open", "said not now"…) and the campaign rule editor suggests
// it there. Using a template copies it into the campaign.

type Template = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  situations: string[];
  source: "written" | "uploaded";
  original_filename: string | null;
  updated_at: string;
};

type Draft = { id?: string; name: string; subject: string; body: string; situations: string[]; source: "written" | "uploaded"; original_filename: string | null };

const blank = (): Draft => ({ name: "", subject: "", body: "", situations: [], source: "written", original_filename: null });

export default function TemplatesPage() {
  const [items, setItems] = useState<Template[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const r = await fetch("/api/templates", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setItems(d.templates ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!draft) return;
    setErr(null);
    setBusy(true);
    try {
      const body = JSON.stringify({
        name: draft.name,
        subject: draft.subject.trim() || null,
        body: draft.body,
        situations: draft.situations,
        source: draft.source,
        original_filename: draft.original_filename,
      });
      const r = draft.id
        ? await fetch(`/api/templates/${draft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body })
        : await fetch("/api/templates", { method: "POST", headers: { "content-type": "application/json" }, body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.error ?? `HTTP ${r.status}`); return; }
      setDraft(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setBusy(false);
    setDraft(null);
    await load();
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/templates/parse", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.error ?? `HTTP ${r.status}`); return; }
      setDraft((prev) => ({
        ...(prev ?? blank()),
        name: prev?.name || f.name.replace(/\.[^.]+$/, ""),
        subject: d.subject ?? prev?.subject ?? "",
        body: d.body,
        source: "uploaded",
        original_filename: f.name,
      }));
    } finally {
      setBusy(false);
    }
  }

  const choosable = SITUATIONS.filter((s) => s.available);

  return (
    <AppShell>
      <div className="page">
        <PageHeader
          eyebrow="Workspace"
          title="Templates"
          subtitle="Follow-up emails you can reuse across campaigns. Tag each with the situations it's written for and the campaign editor will suggest it there."
          actions={
            <>
              <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
                Upload (.docx, .html, .md, .txt)
              </button>
              <button type="button" className="btn-primary text-xs" onClick={() => { setErr(null); setDraft(blank()); }}>
                New template
              </button>
            </>
          }
        />
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.txt,.md,.markdown,.html,.htm"
          className="hidden"
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }}
        />

        {err && !draft && <p className="text-[13px] text-[rgb(252_165_165)] mb-4">{err}</p>}

        {draft && (
          <section className="sheet p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">{draft.id ? "Edit template" : "New template"}</h2>
              {draft.original_filename && <span className="text-[11.5px] text-ink-500">from {draft.original_filename}</span>}
            </div>
            <input className="field-boxed w-full text-[13px]" placeholder="Name (e.g. Didn't open: short re-send)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="field-boxed w-full text-[13px]" placeholder="Subject (optional; used when sent as a new email)" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            <div>
              <div className="label-cap mb-2">Written for</div>
              <div className="flex flex-wrap gap-1.5">
                {choosable.map((s) => {
                  const on = draft.situations.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={on}
                      title={s.meaning}
                      onClick={() => setDraft({ ...draft, situations: on ? draft.situations.filter((x) => x !== s.key) : [...draft.situations, s.key] })}
                      className={`rounded-full border px-2.5 py-1 text-[12px] ${on ? "bg-ink text-paper border-ink" : "bg-surface text-ink-700 border-ink-200 hover:border-ink-400"}`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <BodyEditor value={draft.body} onChange={(v) => setDraft({ ...draft, body: v })} placeholder="The email. Merge tags like {{First Name}} and {{Company}} work." minHeight={220} />
            {err && <p className="text-[13px] text-[rgb(252_165_165)]">{err}</p>}
            <div className="flex items-center gap-3">
              <button type="button" className="btn-primary text-xs" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save template"}</button>
              <button type="button" className="btn-quiet text-xs" onClick={() => { setDraft(null); setErr(null); }}>Cancel</button>
              {draft.id && (
                <button type="button" className="btn-danger text-xs ml-auto" onClick={() => remove(draft.id!)} disabled={busy}>Delete</button>
              )}
            </div>
          </section>
        )}

        {items === null && <div className="h-24 rounded-xl bg-ink-100 animate-pulse" />}
        {items && items.length === 0 && !draft && (
          <EmptyState
            title="No templates yet"
            body="Write one, upload a Word/HTML/Markdown file, or use “Save as template” on any follow-up rule email."
          />
        )}
        {items && items.length > 0 && (
          <div className="sheet divide-y divide-ink-100">
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full text-left px-5 py-4 hover:bg-hover transition-colors"
                onClick={() => {
                  setErr(null);
                  setDraft({ id: t.id, name: t.name, subject: t.subject ?? "", body: t.body, situations: t.situations, source: t.source, original_filename: t.original_filename });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-medium truncate">{t.name}</span>
                  <span className="text-[11px] text-ink-500 shrink-0">
                    {t.source === "uploaded" ? "uploaded · " : ""}
                    {new Date(t.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
                {t.subject && <div className="text-[12.5px] text-ink-700 truncate mt-0.5">{t.subject}</div>}
                <div className="text-[12px] text-ink-500 truncate mt-0.5">{t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}</div>
                {t.situations.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.situations.map((k) => (
                      <span key={k} className="rounded-full border border-ink-200 px-2 py-0.5 text-[10.5px] text-ink-600">
                        {SITUATION_BY_KEY.get(k as SituationKey)?.label ?? k}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <section className="mt-10">
          <h2 className="text-[15px] font-semibold">EmailsVia templates</h2>
          <p className="text-[12.5px] text-ink-500 mt-1 mb-4">
            One for each follow-up situation. They also appear in every campaign&apos;s rule editor under
            &quot;From templates…&quot;. Copy one to your templates to adapt it.
          </p>
          <div className="sheet divide-y divide-ink-100">
            {TEMPLATE_PACK.map((t) => {
              const ready = isPackReady(t);
              const unit = t.suggested.delay_unit === "business_days" ? "business days" : t.suggested.delay_unit;
              return (
                <div key={t.id} className={`px-5 py-4 flex items-start justify-between gap-4 ${ready ? "" : "opacity-70"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-medium">{t.name}</span>
                      <span className="rounded-full border border-ink-200 px-2 py-0.5 text-[10.5px] text-ink-600">
                        {SITUATION_BY_KEY.get(t.situation)?.label ?? t.situation}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink-500 mt-1">{t.goal}</div>
                    <div className="text-[11.5px] text-ink-500 mt-0.5">
                      Suggested: +{t.suggested.delay_value} {unit} after {t.suggested.anchor === "activity" ? "the activity" : "the last email"}
                      {t.suggested.thread_mode === "new" ? " · as a new email" : " · in the same thread"}
                    </div>
                  </div>
                  {ready ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs shrink-0"
                      onClick={() => {
                        setErr(null);
                        setDraft({ name: t.name, subject: t.subject ?? "", body: t.body, situations: [t.situation], source: "written", original_filename: null });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Copy to my templates
                    </button>
                  ) : (
                    <span className="pill-draft shrink-0">coming soon</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
