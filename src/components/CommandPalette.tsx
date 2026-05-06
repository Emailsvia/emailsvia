"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Campaign = { id: string; name: string; status: string; subject: string };
type Sender = { id: string; label: string; email: string; from_name: string | null };
type Recipient = { id: string; name: string; email: string; company: string; campaign_id: string; campaign_name: string; status: string };
type ReplyHit = { id: string; from_email: string; subject: string | null; snippet: string | null; campaign_id: string; campaign_name: string; received_at: string | null; created_at: string };

type SearchResults = {
  campaigns: Campaign[];
  senders: Sender[];
  recipients: Recipient[];
  replies: ReplyHit[];
};

const STATUS_TONE: Record<string, string> = {
  running:  "text-[rgb(110_231_183)]",
  draft:    "text-[rgb(161_161_170)]",
  paused:   "text-[rgb(255_180_110)]",
  done:     "text-[rgb(161_161_170)]",
  archived: "text-[rgb(113_113_122)]",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [initial, setInitial] = useState<{ campaigns: Campaign[]; senders: Sender[] } | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Load first-page list (all campaigns + senders) on open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(null);
    Promise.all([
      fetch("/api/campaigns?archived=1", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ campaigns: [] })),
      fetch("/api/senders", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ senders: [] })),
    ]).then(([c, s]) => setInitial({ campaigns: c.campaigns ?? [], senders: s.senders ?? [] }));
  }, [open]);

  // Server-side fuzzy search for recipients + replies (debounced) when user types
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const d = await r.json();
        setResults(d);
      } catch {}
      finally { setSearching(false); }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open]);

  function go(path: string) { setOpen(false); router.push(path); }

  async function runLogout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isSearching = query.trim().length >= 2;
  const campaignsToShow  = isSearching ? (results?.campaigns ?? [])  : (initial?.campaigns ?? []);
  const sendersToShow    = isSearching ? (results?.senders ?? [])    : (initial?.senders ?? []);
  const recipientsToShow = isSearching ? (results?.recipients ?? []) : [];
  const repliesToShow    = isSearching ? (results?.replies ?? [])    : [];

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
    >
      <button
        type="button"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
      />

      <div
        className="relative w-full max-w-[640px] rounded-2xl overflow-hidden m-glass m-gradient-border"
        style={{
          boxShadow:
            "0 60px 120px -30px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.05), 0 0 80px -20px rgb(255 99 99 / 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette" shouldFilter={false}>
          {/* Search bar */}
          <div className="flex items-center gap-3 px-4 h-14 border-b border-[rgb(255_255_255/0.06)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[rgb(161_161_170)] shrink-0" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search campaigns, recipients, replies, senders…"
              className="flex-1 bg-transparent outline-none text-[15px] text-[rgb(244_244_245)] placeholder:text-[rgb(113_113_122)]"
              spellCheck={false}
              autoComplete="off"
            />
            {searching && (
              <span className="m-mono text-[10.5px] text-[rgb(113_113_122)] animate-pulse">searching…</span>
            )}
            <kbd className="m-mono text-[11px] inline-grid place-items-center h-[20px] px-1.5 rounded border border-[rgb(255_255_255/0.12)] bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)]">esc</kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto py-2">
            <Command.Empty className="py-10 text-center text-[13px] text-[rgb(161_161_170)]">
              {isSearching ? (
                <>Nothing matches <span className="text-[rgb(244_244_245)]">&ldquo;{query}&rdquo;</span>.</>
              ) : (
                <>Start typing to search.</>
              )}
            </Command.Empty>

            {!isSearching && (
              <Group label="Navigate">
                <Item value="nav-campaigns" onSelect={() => go("/app")}        icon={<IconCampaign />}>Campaigns</Item>
                <Item value="nav-replies"   onSelect={() => go("/app/replies")} icon={<IconReply />}>Replies</Item>
                <Item value="nav-senders"   onSelect={() => go("/app/senders")} icon={<IconMail />}>Senders</Item>
                <Item value="nav-billing"   onSelect={() => go("/app/billing")} icon={<IconBilling />}>Billing</Item>
                <Item value="nav-keys"      onSelect={() => go("/app/keys")}    icon={<IconKey />}>API keys</Item>
                <Item value="nav-webhooks"  onSelect={() => go("/app/webhooks")} icon={<IconWebhook />}>Webhooks</Item>
                <Item value="nav-new"       onSelect={() => go("/app/campaigns/new")} icon={<IconPlus />} hint="C">New campaign</Item>
              </Group>
            )}

            {campaignsToShow.length > 0 && (
              <Group label="Campaigns">
                {campaignsToShow.map((c) => (
                  <Item
                    key={c.id}
                    value={`campaign-${c.id}`}
                    onSelect={() => go(`/app/campaigns/${c.id}`)}
                    icon={<IconCampaign />}
                  >
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className={`m-mono text-[10.5px] uppercase tracking-wider ${STATUS_TONE[c.status] || "text-[rgb(113_113_122)]"}`}>
                      {c.status}
                    </span>
                  </Item>
                ))}
              </Group>
            )}

            {recipientsToShow.length > 0 && (
              <Group label="Recipients">
                {recipientsToShow.map((r) => (
                  <Item
                    key={r.id}
                    value={`recipient-${r.id}`}
                    onSelect={() => go(`/app/campaigns/${r.campaign_id}`)}
                    icon={<IconPerson />}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[13.5px] text-[rgb(244_244_245)]">
                        {r.name}
                        <span className="text-[rgb(113_113_122)]"> · {r.company}</span>
                      </div>
                      <div className="m-mono text-[11px] text-[rgb(113_113_122)] truncate">{r.email}</div>
                    </div>
                    <span className="text-[10.5px] text-[rgb(113_113_122)] truncate max-w-[120px]">
                      {r.campaign_name}
                    </span>
                  </Item>
                ))}
              </Group>
            )}

            {repliesToShow.length > 0 && (
              <Group label="Replies">
                {repliesToShow.map((r) => (
                  <Item
                    key={r.id}
                    value={`reply-${r.id}`}
                    onSelect={() => go("/app/replies")}
                    icon={<IconReply />}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[13.5px] text-[rgb(244_244_245)]">
                        {r.subject || "(no subject)"}
                      </div>
                      <div className="m-mono text-[11px] text-[rgb(113_113_122)] truncate">
                        {r.from_email}
                        {r.snippet ? ` · ${r.snippet.slice(0, 60)}${r.snippet.length > 60 ? "…" : ""}` : ""}
                      </div>
                    </div>
                  </Item>
                ))}
              </Group>
            )}

            {sendersToShow.length > 0 && (
              <Group label="Senders">
                {sendersToShow.map((s) => (
                  <Item
                    key={s.id}
                    value={`sender-${s.id}`}
                    onSelect={() => go("/app/senders")}
                    icon={<IconMail />}
                  >
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="m-mono text-[11px] text-[rgb(113_113_122)] truncate max-w-[180px]">
                      {s.email}
                    </span>
                  </Item>
                ))}
              </Group>
            )}

            {!isSearching && (
              <Group label="Actions">
                <Item value="action-logout" onSelect={runLogout} icon={<IconLogout />}>
                  Sign out
                </Item>
              </Group>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 h-9 border-t border-[rgb(255_255_255/0.06)] bg-[rgb(255_255_255/0.02)]">
            <div className="flex items-center gap-3 text-[11px] text-[rgb(113_113_122)]">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                navigate
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                open
              </span>
            </div>
            <span className="m-mono text-[10.5px] text-[rgb(113_113_122)]">EmailsVia · ⌘K</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Command.Group className="px-2">
      <div className="px-3 pt-2 pb-1.5 m-mono text-[10.5px] uppercase tracking-wider text-[rgb(113_113_122)]">
        {label}
      </div>
      <div>{children}</div>
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  value,
  icon,
  hint,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group flex items-center gap-3 mx-1 px-3 py-2 rounded-lg cursor-pointer text-[rgb(244_244_245)] aria-selected:bg-[rgb(255_99_99/0.10)] hover:bg-[rgb(255_255_255/0.04)] transition-colors"
    >
      <span className="grid place-items-center w-7 h-7 rounded-md bg-[rgb(255_255_255/0.04)] text-[rgb(161_161_170)] aria-selected:bg-[rgb(255_99_99/0.18)] aria-selected:text-[rgb(255_140_140)] group-aria-selected:bg-[rgb(255_99_99/0.18)] group-aria-selected:text-[rgb(255_140_140)] transition-colors">
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex items-center gap-2 text-[13.5px]">{children}</div>
      {hint && (
        <kbd className="m-mono text-[10px] inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)] text-[rgb(161_161_170)]">
          {hint}
        </kbd>
      )}
    </Command.Item>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="m-mono inline-grid place-items-center min-w-[16px] h-[16px] px-1 rounded border border-[rgb(255_255_255/0.10)] bg-[rgb(255_255_255/0.03)] text-[10px] text-[rgb(161_161_170)]">
      {children}
    </kbd>
  );
}

/* ----- Icons (14×14) ----- */
function IconCampaign() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}
function IconReply() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
    </svg>
  );
}
function IconPerson() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0116 0v1" />
    </svg>
  );
}
function IconBilling() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </svg>
  );
}
function IconWebhook() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9l-4 6M12 9l4 6M9 17h6" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    </svg>
  );
}
