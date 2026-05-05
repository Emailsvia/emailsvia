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
      finally {
        setSearching(false);
      }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  async function runLogout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isSearching = query.trim().length >= 2;
  const campaignsToShow = isSearching ? (results?.campaigns ?? []) : (initial?.campaigns ?? []);
  const sendersToShow = isSearching ? (results?.senders ?? []) : (initial?.senders ?? []);
  const recipientsToShow = isSearching ? (results?.recipients ?? []) : [];
  const repliesToShow = isSearching ? (results?.replies ?? []) : [];

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <div
            className="relative w-full max-w-xl bg-paper border border-ink-200 rounded-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <Command
              label="Command palette"
              // Disable cmdk's built-in filter — we fetch matches server-side so everything shown should render.
              shouldFilter={false}
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-200">
                <svg className="w-4 h-4 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search campaigns, recipients, replies, senders…"
                  className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-ink-400"
                />
                {searching && (
                  <span className="text-[11px] text-ink-500 animate-pulse">searching…</span>
                )}
                <kbd className="text-[10px] text-ink-500 border border-ink-200 rounded px-1.5 py-0.5 font-mono">ESC</kbd>
              </div>

              <Command.List className="max-h-[55vh] overflow-y-auto py-1">
                <Command.Empty className="py-8 text-center text-[13px] text-ink-500">
                  {isSearching ? "No results." : "Start typing to search."}
                </Command.Empty>

                {!isSearching && (
                  <Command.Group heading="Navigate" className="px-1.5">
                    <Item value="nav-campaigns" onSelect={() => go("/app")}>
                      <NavIcon /> <span>Campaigns</span>
                    </Item>
                    <Item value="nav-replies" onSelect={() => go("/app/replies")}>
                      <ReplyIcon /> <span>Replies</span>
                    </Item>
                    <Item value="nav-senders" onSelect={() => go("/app/senders")}>
                      <MailIcon /> <span>Senders</span>
                    </Item>
                    <Item value="nav-new" onSelect={() => go("/app/campaigns/new")}>
                      <PlusIcon /> <span>New campaign</span>
                    </Item>
                  </Command.Group>
                )}

                {campaignsToShow.length > 0 && (
                  <Command.Group heading="Campaigns" className="px-1.5">
                    {campaignsToShow.map((c) => (
                      <Item key={c.id} value={`campaign-${c.id}`} onSelect={() => go(`/app/campaigns/${c.id}`)}>
                        <CampaignIcon />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="text-[11px] text-ink-500 capitalize">{c.status}</span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {recipientsToShow.length > 0 && (
                  <Command.Group heading="Recipients" className="px-1.5">
                    {recipientsToShow.map((r) => (
                      <Item key={r.id} value={`recipient-${r.id}`} onSelect={() => go(`/app/campaigns/${r.campaign_id}`)}>
                        <PersonIcon />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            <span className="font-medium">{r.name}</span>
                            <span className="text-ink-500"> · {r.company}</span>
                          </div>
                          <div className="text-[11px] text-ink-500 truncate font-mono">{r.email}</div>
                        </div>
                        <span className="text-[11px] text-ink-400 truncate max-w-[120px]">{r.campaign_name}</span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {repliesToShow.length > 0 && (
                  <Command.Group heading="Replies" className="px-1.5">
                    {repliesToShow.map((r) => (
                      <Item key={r.id} value={`reply-${r.id}`} onSelect={() => go("/app/replies")}>
                        <ReplyIcon />
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{r.subject || "(no subject)"}</div>
                          <div className="text-[11px] text-ink-500 truncate">
                            {r.from_email} {r.snippet ? `· ${r.snippet.slice(0, 60)}${r.snippet.length > 60 ? "…" : ""}` : ""}
                          </div>
                        </div>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {sendersToShow.length > 0 && (
                  <Command.Group heading="Senders" className="px-1.5">
                    {sendersToShow.map((s) => (
                      <Item key={s.id} value={`sender-${s.id}`} onSelect={() => go("/app/senders")}>
                        <MailIcon />
                        <span className="flex-1 truncate">{s.label}</span>
                        <span className="text-[11px] font-mono text-ink-500 truncate max-w-[180px]">{s.email}</span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {!isSearching && (
                  <Command.Group heading="Actions" className="px-1.5">
                    <Item value="action-logout" onSelect={runLogout}>
                      <LogoutIcon /> <span>Sign out</span>
                    </Item>
                  </Command.Group>
                )}
              </Command.List>

              <div className="border-t border-ink-200 px-3 py-2 flex items-center justify-between text-[11px] text-ink-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">↑↓</kbd> navigate</span>
                  <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">↵</kbd> select</span>
                </div>
                <span className="flex items-center gap-1"><kbd className="bg-ink-100 border border-ink-200 rounded px-1 text-[9px] font-mono">⌘K</kbd> toggle</span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  );
}

function Item({
  children, onSelect, value,
}: { children: React.ReactNode; onSelect: () => void; value: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px] text-ink cursor-pointer aria-selected:bg-hover"
    >
      {children}
    </Command.Item>
  );
}

function NavIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>;
}
function PlusIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}
function CampaignIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function MailIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function ReplyIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" /></svg>;
}
function PersonIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0116 0v1" /></svg>;
}
function LogoutIcon() {
  return <svg className="w-3.5 h-3.5 text-ink-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /></svg>;
}
