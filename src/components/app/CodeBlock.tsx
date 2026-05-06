"use client";

import { useState } from "react";

/**
 * Mono-font code block with optional copy-to-clipboard button. Tuned for
 * the dark canvas — true-black background, hairline border, mono text.
 */
export default function CodeBlock({
  children,
  language,
  copyable = false,
}: {
  children: string;
  language?: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="relative group rounded-xl border border-ink-200 bg-[rgb(0_0_0/0.35)] overflow-hidden">
      {(language || copyable) && (
        <div className="flex items-center justify-between px-3 h-8 border-b border-ink-200 bg-surface/40">
          {language && (
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
              {language}
            </span>
          )}
          {copyable && (
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-500 hover:text-ink transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  copied
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" />
                  </svg>
                  copy
                </>
              )}
            </button>
          )}
        </div>
      )}
      <pre className="font-mono text-[12px] leading-[1.65] text-ink-700 px-4 py-3 overflow-x-auto">
        {children}
      </pre>
    </div>
  );
}
