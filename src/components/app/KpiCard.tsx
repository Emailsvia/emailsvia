"use client";

/**
 * KPI card for the dashboard strip. Accepts a value, label, optional
 * delta (vs previous period), optional spark data (14d) and tone.
 *
 * Renders as a glass card that warms on hover.
 */

export type SparkPoint = { day: string; sent: number };

export default function KpiCard({
  label,
  value,
  unit,
  delta,
  spark,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: number | null;
  spark?: SparkPoint[];
  tone?: "default" | "hot";
  loading?: boolean;
}) {
  return (
    <div className="relative rounded-xl border border-ink-200 bg-paper hover:border-ink-300 transition-colors overflow-hidden">
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500">
            {label}
          </span>
          {delta !== undefined && delta !== null && <DeltaPill value={delta} />}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={`font-mono text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] tabular-nums ${
              tone === "hot" ? "m-gradient-text" : "text-ink"
            }`}
            style={loading ? { opacity: 0.4 } : undefined}
          >
            {loading ? "—" : value}
          </span>
          {unit && (
            <span className="text-[12px] text-ink-500 font-mono">{unit}</span>
          )}
        </div>
      </div>
      {spark && spark.length > 1 && (
        <div className="px-1 pb-1 -mt-2">
          <Sparkline data={spark} />
        </div>
      )}
    </div>
  );
}

function DeltaPill({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-ink-500">
        <DotChar /> flat
      </span>
    );
  }
  const positive = value > 0;
  const color = positive
    ? { text: "rgb(110 231 183)", bg: "rgb(16 185 129 / 0.10)" }
    : { text: "rgb(255 140 140)", bg: "rgb(255 99 99 / 0.10)" };
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10.5px] px-1.5 py-0.5 rounded-full"
      style={{ color: color.text, background: color.bg }}
    >
      {positive ? "↑" : "↓"} {Math.abs(value)}%
    </span>
  );
}

function DotChar() {
  return <span className="inline-block w-1 h-1 rounded-full bg-ink-400" />;
}

function Sparkline({ data }: { data: SparkPoint[] }) {
  const W = 200;
  const H = 36;
  const max = Math.max(1, ...data.map((d) => d.sent));
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const path = data
    .map((d, i) => {
      const x = i * step;
      const y = H - (d.sent / max) * (H - 6) - 3;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const fillPath = `${path} L ${(W).toFixed(1)} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9 block" aria-hidden preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${data.length}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgb(255 99 99)" />
          <stop offset="100%" stopColor="rgb(255 159 67)" />
        </linearGradient>
        <linearGradient id={`spark-fill-${data.length}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(255 99 99 / 0.18)" />
          <stop offset="100%" stopColor="rgb(255 99 99 / 0)" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#spark-fill-${data.length})`} />
      <path d={path} fill="none" stroke={`url(#spark-${data.length})`} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
