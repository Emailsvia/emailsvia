"use client";

import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/auth/AuthShell";
import {
  AuthLabel,
  AuthInput,
  AuthPrimaryButton,
} from "@/components/auth/AuthForm";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="text-center space-y-5">
          <div className="mx-auto grid place-items-center w-14 h-14 rounded-2xl m-glass">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[rgb(255_140_140)]" aria-hidden>
              <path d="M3 7l9 6 9-6M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M3 7l2-2h14l2 2" />
            </svg>
          </div>
          <h1 className="m-display text-[28px] leading-tight">Reset link sent.</h1>
          <p className="m-body text-[14px]">
            If an account exists for{" "}
            <span className="text-[rgb(244_244_245)] m-mono text-[13px]">{email}</span>, the
            link is on its way. Open it from a browser signed into the same Gmail.
          </p>
          <Link
            href="/login"
            className="m-btn m-btn-ghost text-[14px] py-2.5 inline-flex w-full"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="space-y-6">
        <header>
          <h1 className="m-display text-[32px] sm:text-[36px] leading-[1.05]">
            Reset password
          </h1>
          <p className="m-body text-[14px] mt-2">
            Happens to everyone. Enter the email on your account and we&rsquo;ll send a
            reset link.
          </p>
        </header>

        <div className="space-y-4">
          <div>
            <AuthLabel htmlFor="forgot-email">Email</AuthLabel>
            <AuthInput
              id="forgot-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>

          <AuthPrimaryButton disabled={!email} loading={loading}>
            Send reset link
          </AuthPrimaryButton>

          <div className="flex items-center justify-between text-[13px] text-[rgb(161_161_170)] pt-2">
            <Link
              href="/login"
              className="hover:text-[rgb(244_244_245)] transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 2L3 6l4 4" />
              </svg>
              Back to sign in
            </Link>
            <Link
              href="/signup"
              className="hover:text-[rgb(244_244_245)] transition-colors cursor-pointer"
            >
              Create account
            </Link>
          </div>
        </div>
      </form>
    </AuthShell>
  );
}
