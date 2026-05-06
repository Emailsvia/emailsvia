"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import CommandPalette from "@/components/CommandPalette";
import AppAlerts from "@/components/AppAlerts";

type NavSection = {
  label: string;
  items: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
};

const NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/app",          label: "Campaigns", icon: IconCampaign },
      { href: "/app/replies",  label: "Replies",   icon: IconReply    },
      { href: "/app/senders",  label: "Senders",   icon: IconMail     },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/app/billing",  label: "Billing",   icon: IconBilling  },
      { href: "/app/keys",     label: "API keys",  icon: IconKey      },
      { href: "/app/webhooks", label: "Webhooks",  icon: IconWebhook  },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/app") {
      return pathname === "/app" || pathname.startsWith("/app/campaigns");
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="min-h-screen flex bg-paper text-ink">
      {/* sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] flex flex-col
          border-r border-ink-200 bg-surface
          transform transition-transform duration-300 ease-out md:translate-x-0
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        aria-label="Primary"
      >
        {/* Workspace branding */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-ink-200">
          <Link href="/app" className="flex items-center gap-2 group">
            <span className="grid place-items-center w-7 h-7 rounded-md bg-ink-100 border border-ink-200 group-hover:border-ink-300 transition-colors">
              <Logo size={16} />
            </span>
            <span className="font-semibold text-[14px] tracking-[-0.01em]">EmailsVia</span>
          </Link>
          <button
            className="md:hidden grid place-items-center w-7 h-7 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Nav */}
        <div className="px-2 flex-1 overflow-y-auto py-3 space-y-5">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="px-2 pb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
                {section.label}
              </div>
              <nav className="space-y-0.5">
                {section.items.map((it) => {
                  const Icon = it.icon;
                  const active = isActive(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={`group relative flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md text-[13.5px] cursor-pointer transition-colors
                        ${active
                          ? "bg-hover text-ink"
                          : "text-ink-700 hover:text-ink hover:bg-hover"
                        }`}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r"
                          style={{ background: "linear-gradient(180deg, rgb(var(--m-coral)), rgb(var(--m-amber)))" }}
                        />
                      )}
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{it.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}

          {/* Quick action */}
          <div>
            <div className="px-2 pb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
              Quick actions
            </div>
            <Link
              href="/app/campaigns/new"
              className="flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md text-[13.5px] text-ink-700 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
            >
              <IconPlus className="w-4 h-4 shrink-0" />
              <span>New campaign</span>
              <span className="ml-auto font-mono text-[10px] text-ink-400 border border-ink-200 rounded px-1 py-px">
                C
              </span>
            </Link>
          </div>
        </div>

        {/* Bottom: plan card + footer actions */}
        <div className="border-t border-ink-200 p-2 space-y-2">
          <PlanCard />
          <div className="grid grid-cols-2 gap-1">
            <ThemeToggle variant="compact" />
            <button
              type="button"
              onClick={logout}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[12.5px] text-ink-600 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
              title="Sign out"
            >
              <IconLogout className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 h-12 z-30 flex items-center justify-between px-4 bg-paper/85 backdrop-blur-md border-b border-ink-200">
        <button
          onClick={() => setMobileOpen(true)}
          className="grid place-items-center w-8 h-8 rounded-md text-ink-700 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
          aria-label="Open menu"
        >
          <IconMenu className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 text-ink">
          <Logo size={16} />
          <span className="font-semibold text-[14px] tracking-[-0.01em]">EmailsVia</span>
        </div>
        <CommandPaletteTriggerCompact />
      </header>

      {/* mobile drawer scrim */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* main column */}
      <div className="flex-1 md:ml-[248px] pt-12 md:pt-0 min-w-0 flex flex-col">
        <DesktopTopBar />
        <AppAlerts />
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      <CommandPalette />
    </div>
  );
}

/* -------------------------------------------------------------------------
   Desktop top bar — sticky glass surface, ⌘K trigger, alerts bell, theme,
   user chip. Visible md+ only; mobile uses the simpler header above.
   ------------------------------------------------------------------------- */

function DesktopTopBar() {
  return (
    <header className="hidden md:flex sticky top-0 z-20 h-14 items-center gap-3 px-6 lg:px-10 bg-paper/72 backdrop-blur-xl border-b border-ink-200">
      <div className="flex-1" />
      <CommandPaletteTrigger />
      <AlertsBell />
      <UserChip />
    </header>
  );
}

function CommandPaletteTrigger() {
  function open() {
    // Existing CommandPalette listens for ⌘K. Synthesize one from a click.
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true });
    document.dispatchEvent(e);
  }
  return (
    <button
      type="button"
      onClick={open}
      className="hidden sm:inline-flex items-center gap-3 h-9 pl-3 pr-2 rounded-lg border border-ink-200 bg-surface text-[13px] text-ink-500 hover:text-ink hover:border-ink-300 transition-colors cursor-pointer min-w-[260px]"
      aria-label="Open command palette"
    >
      <IconSearch className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 text-left">Search anything…</span>
      <span className="inline-flex items-center gap-1">
        <kbd className="font-mono inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-ink-200 bg-paper text-[10px] text-ink-600">⌘</kbd>
        <kbd className="font-mono inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded border border-ink-200 bg-paper text-[10px] text-ink-600">K</kbd>
      </span>
    </button>
  );
}

function CommandPaletteTriggerCompact() {
  function open() {
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true });
    document.dispatchEvent(e);
  }
  return (
    <button
      type="button"
      onClick={open}
      className="grid place-items-center w-8 h-8 rounded-md text-ink-700 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
      aria-label="Search"
    >
      <IconSearch className="w-4 h-4" />
    </button>
  );
}

function AlertsBell() {
  // Watches the same /api/app/alerts feed as <AppAlerts/>; shows a badge dot
  // when something is pending. Click does nothing yet (alerts banner stays
  // primary surface); we'll wire a dropdown in Part 7.
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/app/alerts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { alerts: [] }))
        .then((d) => { if (!cancelled) setCount((d.alerts ?? []).length); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return (
    <button
      type="button"
      className="relative grid place-items-center w-9 h-9 rounded-lg text-ink-600 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
      aria-label={count > 0 ? `${count} alerts` : "No alerts"}
      title={count > 0 ? `${count} alert${count === 1 ? "" : "s"}` : "All clear"}
    >
      <IconBell className="w-4 h-4" />
      {count > 0 && (
        <span
          className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
          style={{
            background: "rgb(var(--m-coral))",
            boxShadow: "0 0 8px rgb(var(--m-coral) / 0.6)",
          }}
        />
      )}
    </button>
  );
}

function UserChip() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid place-items-center w-9 h-9 rounded-lg cursor-pointer transition-all hover:scale-105"
        aria-label="Account"
        aria-expanded={open}
        style={{
          background: "linear-gradient(135deg, rgb(var(--m-coral) / 0.20), rgb(var(--m-amber) / 0.18))",
          border: "1px solid rgb(var(--m-coral) / 0.25)",
        }}
      >
        <span className="font-mono text-[12px] font-semibold text-ink">
          <IconUserGlyph />
        </span>
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-52 rounded-xl bg-paper border border-ink-200 shadow-2xl overflow-hidden"
          style={{
            boxShadow:
              "0 30px 80px -20px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.04)",
          }}
        >
          <Link
            href="/app/billing"
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover transition-colors cursor-pointer"
          >
            <IconBilling className="w-3.5 h-3.5 text-ink-500" />
            <span>Plan &amp; billing</span>
          </Link>
          <Link
            href="/app/keys"
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover transition-colors cursor-pointer"
          >
            <IconKey className="w-3.5 h-3.5 text-ink-500" />
            <span>API keys</span>
          </Link>
          <div className="border-t border-ink-200" />
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-hover transition-colors cursor-pointer text-left"
          >
            <IconLogout className="w-3.5 h-3.5 text-ink-500" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Plan card — shown at the bottom of the sidebar. Stays a static "Free"
   label until Part 7 wires real usage; the visual sells the upgrade path.
   ------------------------------------------------------------------------- */

function PlanCard() {
  return (
    <Link
      href="/app/billing"
      className="block rounded-lg border border-ink-200 bg-surface px-3 py-2.5 hover:border-ink-300 transition-colors cursor-pointer group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
          Current plan
        </span>
        <span className="text-[10.5px] font-mono text-ink-600 group-hover:text-ink transition-colors">
          Manage →
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink">Free</span>
        <span className="font-mono text-[11px] text-ink-500">50/day</span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-ink-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: "12%",
            background: "linear-gradient(90deg, rgb(var(--m-coral)), rgb(var(--m-amber)))",
          }}
        />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------
   Icon set — single-stroke Heroicons-derived. `className` controls size.
   ------------------------------------------------------------------------- */

function IconCampaign({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}
function IconReply({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
    </svg>
  );
}
function IconMail({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
    </svg>
  );
}
function IconBilling({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}
function IconKey({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </svg>
  );
}
function IconWebhook({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9l-4 6M12 9l4 6M9 17h6" />
    </svg>
  );
}
function IconPlus({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconLogout({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 17l5-5-5-5M20 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    </svg>
  );
}
function IconMenu({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function IconX({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M6 18L18 6" />
    </svg>
  );
}
function IconSearch({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}
function IconBell({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z" />
      <path d="M10 21a2 2 0 004 0" />
    </svg>
  );
}
function IconUserGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}
