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
      <div className="rounded-md border border-ink-200 bg-surface p-4 text-[14px]">
        You won't receive any more emails from this sender. Sorry for the noise.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={confirm} disabled={state === "loading"} className="btn-primary flex-1">
          {state === "loading" ? "Unsubscribing…" : `Unsubscribe ${email}`}
        </button>
        <a href="/" className="btn-ghost flex-1 text-center justify-center">Keep me subscribed</a>
      </div>
      {state === "error" && (
        <p className="text-[13px] text-red-600 mt-3">Something went wrong. Try again.</p>
      )}
    </>
  );
}
