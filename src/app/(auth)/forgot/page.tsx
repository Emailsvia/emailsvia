"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

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

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10 text-ink">
          <Logo size={28} />
          <span className="font-semibold text-[16px] tracking-tight">EmailsVia</span>
        </div>

        {sent ? (
          <>
            <h1 className="text-xl font-semibold mb-3">Check your inbox</h1>
            <p className="text-[13px] text-ink-500 mb-6">
              If an account exists for <span className="text-ink">{email}</span>, we just sent
              a password-reset link. Open it from a browser signed into the same Gmail to
              finish the reset.
            </p>
            <Link href="/login" className="btn-ghost w-full inline-block text-center">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <h1 className="text-xl font-semibold mb-1">Reset password</h1>
            <p className="text-[13px] text-ink-500 mb-8">
              Enter your account email and we&rsquo;ll send a reset link.
            </p>

            <div className="space-y-5">
              <div>
                <label htmlFor="forgot-email" className="label-cap">Email</label>
                <input
                  id="forgot-email"
                  className="field-boxed"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="btn-accent w-full"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>

              <div className="flex items-center justify-between text-[13px] text-ink-500">
                <Link href="/login" className="hover:text-ink">Back to sign in</Link>
                <Link href="/signup" className="hover:text-ink">Sign up</Link>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
