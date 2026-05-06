"use client";

import { useState } from "react";

export default function UnsubscribeClient({ token, email }: { token: string; email: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function confirm() {
    setState("loading");
    const r = await fetch("/api/unsubscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setState(r.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div
        className="rounded-xl p-4 text-[13.5px] flex items-start gap-3"
        style={{
          background: "rgb(16 185 129 / 0.08)",
          borderColor: "rgb(16 185 129 / 0.30)",
          color: "rgb(244 244 245)",
          border: "1px solid rgb(16 185 129 / 0.30)",
        }}
      >
        <span
          className="mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0"
          style={{ background: "rgb(16 185 129 / 0.18)", color: "rgb(110 231 183)" }}
          aria-hidden
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <span>
          You won&rsquo;t receive any more emails from this sender. Sorry for the noise.
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={confirm}
          disabled={state === "loading"}
          className="m-btn m-btn-primary flex-1 text-[14px] py-2.5"
        >
          {state === "loading" ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin" aria-hidden>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" fill="none" />
                <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              </svg>
              Unsubscribing…
            </>
          ) : (
            <>Unsubscribe {email}</>
          )}
        </button>
        <a
          href="/"
          className="m-btn m-btn-ghost flex-1 text-[14px] py-2.5 justify-center"
        >
          Keep me subscribed
        </a>
      </div>
      {state === "error" && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-[13px] border flex items-start gap-2"
          style={{
            borderColor: "rgb(255 99 99 / 0.30)",
            background: "rgb(255 99 99 / 0.06)",
            color: "rgb(255 140 140)",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="mt-0.5 shrink-0" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>Something went wrong. Try again.</span>
        </div>
      )}
    </>
  );
}
