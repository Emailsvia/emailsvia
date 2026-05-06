"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * Raycast-style command bar. Triggered by ⌘K / Ctrl-K, by clicking
 * the hint chip exposed via <CommandBarTrigger />, or programmatically.
 * Filters across navigation + actions + docs. Real keyboard navigation.
 */

type Item = {
  id: string;
  label: string;
  hint?: string;
  href?: string;
  shortcut?: string[];
  group: "Get started" | "Navigate" | "Use cases" | "Resources";
  icon: React.ReactNode;
};

const ITEMS: Item[] = [
  { id: "signup",   label: "Start free",                  hint: "50 sends a day, no card",   href: "/signup",      shortcut: ["⏎"],         group: "Get started", icon: <IconSpark /> },
  { id: "login",    label: "Sign in",                     hint: "Welcome back",              href: "/login",                                 group: "Get started", icon: <IconKey /> },
  { id: "pricing",  label: "Pricing",                     hint: "Free → $39",                href: "/pricing",                               group: "Navigate",    icon: <IconTag /> },
  { id: "founders", label: "For founders",                hint: "Doing it yourself",         href: "/?role=founders",                        group: "Use cases",   icon: <IconUser /> },
  { id: "sales",    label: "For sales teams",             hint: "Inbox rotation, A/B",       href: "/?role=sales",                           group: "Use cases",   icon: <IconUser /> },
  { id: "rec",      label: "For recruiters",              hint: "Threaded follow-ups",       href: "/?role=recruiters",                      group: "Use cases",   icon: <IconUser /> },
  { id: "jobs",     label: "For job seekers",             hint: "Outreach that gets read",   href: "/?role=jobseekers",                      group: "Use cases",   icon: <IconUser /> },
  { id: "support",  label: "For customer support",        hint: "Proactive check-ins",       href: "/?role=support",                         group: "Use cases",   icon: <IconUser /> },
  { id: "free",     label: "For freelancers",             hint: "$9, no CRM",                href: "/?role=freelancers",                     group: "Use cases",   icon: <IconUser /> },
  { id: "mkt",      label: "For marketers",               hint: "1:1 outbound that scales",  href: "/?role=marketers",                       group: "Use cases",   icon: <IconUser /> },
  { id: "docs",     label: "How it works",                hint: "Open the explainer",        href: "#how",                                   group: "Resources",   icon: <IconBook /> },
  { id: "compare",  label: "Compare to Mailmeteor",       hint: "Honest matrix",             href: "/pricing#compare",                       group: "Resources",   icon: <IconScale /> },
  { id: "privacy",  label: "Privacy",                     href: "/privacy",                                                                  group: "Resources",   icon: <IconShield /> },
  { id: "terms",    label: "Terms",                       href: "/terms",                                                                    group: "Resources",   icon: <IconScale /> },
];

export function CommandBarTrigger({ className = "" }: { className?: string }) {
  const open = () => window.dispatchEvent(new CustomEvent("emv:command-open"));
  return (
    <button
      type="button"
      onClick={open}
      className={`m-btn m-btn-ghost text-[13px] py-1.5 ${className}`}
      aria-label="Open command bar"
    >
      <span className="text-[rgb(161_161_170)]">Search</span>
      <span className="inline-flex items-center gap-1 m-mono text-[11px] text-[rgb(161_161_170)]">
        <kbd className="inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)]">⌘</kbd>
        <kbd className="inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)]">K</kbd>
      </span>
    </button>
  );
}

export default function CommandBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open via shortcut, custom event, or hint click
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onCustom = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("emv:command-open", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("emv:command-open", onCustom);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.hint || "").toLowerCase().includes(q) ||
        it.group.toLowerCase().includes(q),
    );
  }, [query]);

  // Group filtered items in stable order
  const groups = useMemo(() => {
    const order: Item["group"][] = ["Get started", "Navigate", "Use cases", "Resources"];
    return order
      .map((name) => ({ name, items: filtered.filter((i) => i.group === name) }))
      .filter((g) => g.items.length);
  }, [filtered]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Clamp selection
  useEffect(() => {
    if (selected >= flat.length) setSelected(Math.max(0, flat.length - 1));
  }, [flat.length, selected]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      const item = flat[selected];
      if (item?.href) {
        window.location.assign(item.href);
        setOpen(false);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Command bar"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
      onKeyDown={onListKey}
    >
      {/* Scrim */}
      <button
        aria-label="Close command bar"
        type="button"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-[640px] m-glass rounded-2xl overflow-hidden m-gradient-border"
        style={{
          boxShadow:
            "0 60px 120px -30px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.05), 0 0 80px -20px rgb(255 99 99 / 0.25)",
        }}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-[rgb(255_255_255/0.06)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[rgb(161_161_170)]" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Type a command, page, or audience…"
            className="flex-1 bg-transparent outline-none text-[15px] text-[rgb(244_244_245)] placeholder:text-[rgb(113_113_122)]"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="m-mono text-[11px] inline-grid place-items-center h-[20px] px-1.5 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)]">esc</kbd>
        </div>

        {/* List */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto py-2"
        >
          {groups.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-[rgb(161_161_170)]">
              Nothing matches <span className="text-[rgb(244_244_245)]">&ldquo;{query}&rdquo;</span>.
              Try <span className="m-mono text-[12px] text-[rgb(244_244_245)]">pricing</span> or
              <span className="m-mono text-[12px] text-[rgb(244_244_245)]"> founders</span>.
            </div>
          )}
          {groups.map((g) => {
            let runningIdx = 0;
            for (const prev of groups) {
              if (prev.name === g.name) break;
              runningIdx += prev.items.length;
            }
            return (
              <div key={g.name} className="px-2">
                <div className="px-3 pt-2 pb-1.5 m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)]">
                  {g.name}
                </div>
                <div>
                  {g.items.map((it, i) => {
                    const idx = runningIdx + i;
                    const isSel = selected === idx;
                    return (
                      <Link
                        key={it.id}
                        href={it.href || "#"}
                        data-idx={idx}
                        onClick={() => setOpen(false)}
                        onMouseEnter={() => setSelected(idx)}
                        className={`group flex items-center gap-3 mx-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          isSel
                            ? "bg-[rgb(255_99_99/0.10)]"
                            : "hover:bg-[rgb(255_255_255/0.04)]"
                        }`}
                      >
                        <span className={`grid place-items-center w-7 h-7 rounded-md ${isSel ? "bg-[rgb(255_99_99/0.18)] text-[rgb(255_140_140)]" : "bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)]"}`}>
                          {it.icon}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] text-[rgb(244_244_245)] truncate">{it.label}</span>
                          {it.hint && (
                            <span className="block text-[11.5px] text-[rgb(113_113_122)] truncate">{it.hint}</span>
                          )}
                        </span>
                        <span className="m-mono text-[10.5px] text-[rgb(113_113_122)] opacity-80">
                          {isSel ? "↵" : ""}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-9 border-t border-[rgb(255_255_255/0.06)] bg-[rgb(255_255_255/0.02)]">
          <div className="flex items-center gap-3 text-[11px] text-[rgb(113_113_122)]">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="m-mono inline-grid place-items-center min-w-[16px] h-[16px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)]">↑</kbd>
              <kbd className="m-mono inline-grid place-items-center min-w-[16px] h-[16px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)]">↓</kbd>
              navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="m-mono inline-grid place-items-center min-w-[16px] h-[16px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)]">↵</kbd>
              open
            </span>
          </div>
          <span className="m-mono text-[10.5px] text-[rgb(113_113_122)]">EmailsVia · ⌘K</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- inline 16x16 icons (Heroicons-derived, single-stroke) ---------- */

function IconSpark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12l9-9 9 9-9 9z" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4h12a3 3 0 013 3v13H7a3 3 0 01-3-3V4z" />
      <path d="M4 17a3 3 0 013-3h12" />
    </svg>
  );
}
function IconScale() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v16M4 8h16M6 8l-2 6h6l-2-6M18 8l-2 6h6l-2-6" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z" />
    </svg>
  );
}
