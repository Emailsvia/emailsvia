"use client";

import { useState } from "react";

/**
 * Form primitives shared across /login, /signup, /forgot. Dark-canvas tuned
 * inputs, buttons with the warm-glow hover, divider, error pill, etc.
 */

export function AuthLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="m-mono text-[10.5px] uppercase tracking-wider text-[rgb(161_161_170)] block mb-1.5"
    >
      {children}
    </label>
  );
}

export function AuthInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean },
) {
  const { hasError, className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full bg-[rgb(255_255_255/0.03)] border rounded-xl px-3.5 py-2.5 text-[14px] text-[rgb(244_244_245)] placeholder:text-[rgb(113_113_122)] outline-none transition-colors ${
        hasError
          ? "border-[rgb(255_99_99/0.4)] focus:border-[rgb(255_99_99/0.7)]"
          : "border-[rgb(255_255_255/0.08)] focus:border-[rgb(255_99_99/0.5)] hover:border-[rgb(255_255_255/0.14)]"
      } ${className}`}
    />
  );
}

export function AuthPasswordInput(
  props: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean },
) {
  const { hasError, className = "", ...rest } = props;
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        className={`w-full bg-[rgb(255_255_255/0.03)] border rounded-xl px-3.5 pr-10 py-2.5 text-[14px] text-[rgb(244_244_245)] placeholder:text-[rgb(113_113_122)] outline-none transition-colors ${
          hasError
            ? "border-[rgb(255_99_99/0.4)] focus:border-[rgb(255_99_99/0.7)]"
            : "border-[rgb(255_255_255/0.08)] focus:border-[rgb(255_99_99/0.5)] hover:border-[rgb(255_255_255/0.14)]"
        } ${className}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-[rgb(161_161_170)] hover:text-[rgb(244_244_245)] hover:bg-[rgb(255_255_255/0.04)] transition-colors cursor-pointer"
        aria-label={shown ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {shown ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
}

export function AuthPrimaryButton({
  children,
  loading,
  disabled,
  type = "submit",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className="m-btn m-btn-primary w-full text-[14px] py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <>
          <Spinner />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function AuthGhostButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type="button"
      className="m-btn m-btn-ghost w-full text-[14px] py-2.5 cursor-pointer"
    >
      {children}
    </button>
  );
}

export function AuthDivider({ children = "or" }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-5 text-[11px] m-mono uppercase tracking-wider text-[rgb(113_113_122)]">
      <div className="h-px flex-1 bg-[rgb(255_255_255/0.06)]" />
      <span>{children}</span>
      <div className="h-px flex-1 bg-[rgb(255_255_255/0.06)]" />
    </div>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[rgb(255_99_99/0.08)] border border-[rgb(255_99_99/0.20)] text-[13px] text-[rgb(255_140_140)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export function GoogleButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      className="m-btn m-btn-ghost w-full text-[14px] py-2.5 cursor-pointer gap-2.5"
    >
      <GoogleGlyph />
      <span>Continue with Google</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" fill="none" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconEyeOff() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18M10.6 10.6a3 3 0 1 0 4.2 4.2" />
      <path d="M9.4 5.5A10 10 0 0 1 22 12a17 17 0 0 1-2.6 3.4M6.4 6.4A17 17 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.6-.9" />
    </svg>
  );
}
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.4-11.3-8l-6.5 5C9.6 39.7 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.6l6.2 5.2C40.7 36 44 30.4 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
