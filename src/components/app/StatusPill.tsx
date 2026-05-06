"use client";

/**
 * Status pill used across the app for campaign / sender / recipient state.
 * Each tone has a colored dot + tinted background.
 */

type Status =
  | "running" | "draft" | "paused" | "done" | "archived" | "failed"
  | "pending" | "sent" | "replied" | "bounced" | "unsubscribed" | "skipped"
  | "ok" | "revoked";

const TONE: Record<Status, { dot: string; text: string; bg: string }> = {
  running:      { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
  ok:           { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
  sent:         { dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
  replied:      { dot: "rgb(255 99 99)",   text: "rgb(255 140 140)", bg: "rgb(255 99 99 / 0.10)" },
  paused:       { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  pending:      { dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  failed:       { dot: "rgb(239 68 68)",   text: "rgb(252 165 165)", bg: "rgb(239 68 68 / 0.10)" },
  bounced:      { dot: "rgb(239 68 68)",   text: "rgb(252 165 165)", bg: "rgb(239 68 68 / 0.10)" },
  revoked:      { dot: "rgb(239 68 68)",   text: "rgb(252 165 165)", bg: "rgb(239 68 68 / 0.10)" },
  unsubscribed: { dot: "rgb(161 161 170)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  skipped:      { dot: "rgb(161 161 170)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  done:         { dot: "rgb(161 161 170)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  archived:     { dot: "rgb(113 113 122)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  draft:        { dot: "rgb(113 113 122)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
};

export default function StatusPill({ status }: { status: string }) {
  const tone = TONE[status as Status] ?? TONE.draft;
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ color: tone.text, background: tone.bg }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: tone.dot }}
      />
      {status}
    </span>
  );
}
