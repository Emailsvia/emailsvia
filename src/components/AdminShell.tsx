"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

// Operator-only chrome. Mirrors AppShell's structure so the navigation
// pattern is familiar, but every link goes to /admin/*. Middleware enforces
// strict zone separation — admins never land in /app and vice versa.

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavSection = { label: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    label: "Operator",
    items: [
      { href: "/admin",           label: "Overview",     icon: IconOverview },
      { href: "/admin/users",     label: "Users",        icon: IconUser     },
      { href: "/admin/campaigns", label: "Campaigns",    icon: IconCampaign },
      { href: "/admin/senders",   label: "Senders",      icon: IconMail     },
      { href: "/admin/replies",   label: "Replies",      icon: IconReply    },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/admin/billing",   label: "Billing & MRR", icon: IconBilling },
      { href: "/admin/webhooks",  label: "Webhook log",   icon: IconWebhook },
      { href: "/admin/system",    label: "System",        icon: IconSystem  },
    ],
  },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
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
        aria-label="Operator navigation"
      >
        {/* Workspace branding — operator pill marks this as a different zone */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-ink-200">
          <Link href="/admin" className="flex items-center gap-2 group min-w-0">
            <span
              className="grid place-items-center w-7 h-7 rounded-md shrink-0"
              style={{
                background: "linear-gradient(135deg, rgb(var(--m-coral) / 0.20), rgb(var(--m-amber) / 0.18))",
                border: "1px solid rgb(var(--m-coral) / 0.25)",
                color: "rgb(255 140 140)",
              }}
            >
              <Logo size={14} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-[14px] tracking-[-0.01em] truncate">EmailsVia</div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(255_140_140)] mt-px">
                Operator
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden grid place-items-center w-7 h-7 rounded-md text-ink-500 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
            aria-label="Close menu"
          >
            <IconX className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Nav sections */}
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
        </div>

        {/* Footer: theme + sign out */}
        <div className="border-t border-ink-200 p-2 space-y-1">
          <ThemeToggle variant="compact" />
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[12.5px] text-ink-600 hover:text-ink hover:bg-hover transition-colors cursor-pointer"
            title="Sign out"
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
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
          <Logo size={14} />
          <span className="font-semibold text-[14px] tracking-[-0.01em]">EmailsVia</span>
          <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[rgb(255_140_140)]">Operator</span>
        </div>
        <div className="w-8" />
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
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */

function DesktopTopBar() {
  return (
    <header className="hidden md:flex sticky top-0 z-20 h-14 items-center gap-3 px-6 lg:px-10 bg-paper/72 backdrop-blur-xl border-b border-ink-200">
      <span
        className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider px-2.5 py-1 rounded-full"
        style={{
          background: "rgb(255 99 99 / 0.08)",
          color: "rgb(255 140 140)",
          border: "1px solid rgb(255 99 99 / 0.20)",
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: "rgb(255 99 99)", boxShadow: "0 0 8px rgb(255 99 99 / 0.6)" }}
        />
        Cross-tenant view
      </span>
      <div className="flex-1" />
      <Link
        href="/app"
        className="hidden lg:inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink transition-colors cursor-pointer"
        title="Operators are blocked from /app by middleware — this link is for reference only."
      >
        <IconExternal className="w-3.5 h-3.5" />
        <span>User app</span>
      </Link>
    </header>
  );
}

/* ----- Icons ----- */

function IconOverview({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconUser({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}
function IconCampaign({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
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
function IconReply({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v2" />
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
function IconSystem({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82c.16.36.41.64.7.84" />
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
function IconExternal({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 5h5v5M19 5l-9 9M9 5H5v14h14v-4" />
    </svg>
  );
}
