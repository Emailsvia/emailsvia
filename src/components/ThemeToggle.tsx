"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "auto";

function applyTheme(theme: Theme) {
  const effective =
    theme === "auto"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : theme;
  document.documentElement.dataset.theme = effective;
}

export default function ThemeToggle({ variant = "sidebar" }: { variant?: "sidebar" | "compact" }) {
  const [theme, setTheme] = useState<Theme>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme) || "auto";
    setTheme(stored);
    setMounted(true);
  }, []);

  function cycle() {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const icon = theme;
  const label = theme === "auto" ? "Auto" : theme === "dark" ? "Dark" : "Light";

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={cycle}
        className="btn-quiet px-2"
        title={`Theme: ${label}`}
        aria-label={`Toggle theme (currently ${label})`}
      >
        <ThemeIcon name={icon} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="side-link w-full justify-between group"
      title="Click to cycle: Light → Dark → Auto"
    >
      <span className="flex items-center gap-2">
        <ThemeIcon name={icon} />
        <span>Theme</span>
      </span>
      <span className="text-[12px] text-ink-500 group-hover:text-ink">
        {mounted ? label : "Auto"}
      </span>
    </button>
  );
}

function ThemeIcon({ name }: { name: Theme }) {
  if (name === "light")
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5" />
      </svg>
    );
  if (name === "dark")
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    );
  // auto — half-moon/sun
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 010 18" fill="currentColor" />
    </svg>
  );
}
