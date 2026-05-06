"use client";

/**
 * Intent badge for AI-classified replies. 7 known intents + an
 * "uncategorized" slot for replies still being processed.
 *
 * Tone mapping (matches StatusPill): green = positive, coral = action,
 * amber = soft pass, red = explicit reject, gray = noise.
 */

export type Intent =
  | "interested" | "question" | "not_now" | "unsubscribe"
  | "ooo" | "bounce" | "other" | "uncategorized";

const TONE: Record<Intent, { label: string; dot: string; text: string; bg: string }> = {
  interested:    { label: "Interested",    dot: "rgb(16 185 129)",  text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" },
  question:      { label: "Question",      dot: "rgb(255 99 99)",   text: "rgb(255 140 140)", bg: "rgb(255 99 99 / 0.10)" },
  not_now:       { label: "Not now",       dot: "rgb(255 159 67)",  text: "rgb(255 180 110)", bg: "rgb(255 159 67 / 0.10)" },
  unsubscribe:   { label: "Unsubscribe",   dot: "rgb(239 68 68)",   text: "rgb(252 165 165)", bg: "rgb(239 68 68 / 0.10)" },
  ooo:           { label: "Out of office", dot: "rgb(161 161 170)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  bounce:        { label: "Bounce",        dot: "rgb(161 161 170)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  other:         { label: "Other",         dot: "rgb(113 113 122)", text: "rgb(161 161 170)", bg: "rgb(255 255 255 / 0.04)" },
  uncategorized: { label: "Uncategorized", dot: "rgb(113 113 122)", text: "rgb(113 113 122)", bg: "rgb(255 255 255 / 0.03)" },
};

export const INTENT_ORDER: Intent[] = [
  "interested", "question", "not_now", "unsubscribe", "ooo", "bounce", "other", "uncategorized",
];

export function intentTone(intent: Intent | string | null | undefined) {
  const key = (intent ?? "uncategorized") as Intent;
  return TONE[key] ?? TONE.uncategorized;
}

export default function IntentBadge({
  intent,
  confidence,
  size = "sm",
}: {
  intent: Intent | null;
  confidence?: number | null;
  size?: "xs" | "sm";
}) {
  const tone = intentTone(intent);
  const sizeClass =
    size === "xs"
      ? "text-[10px] px-1.5 py-0.5"
      : "text-[11px] px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono uppercase tracking-wider rounded-full ${sizeClass}`}
      style={{ color: tone.text, background: tone.bg }}
      title={confidence != null ? `confidence ${(confidence * 100).toFixed(0)}%` : undefined}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
      {tone.label}
    </span>
  );
}
