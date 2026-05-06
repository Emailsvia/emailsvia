"use client";

// Tiny dependency-free chart components for the admin dashboard. We render
// pure SVG so we can ship without recharts/visx. Two variants: a single-
// series area+line for top-line metrics (Sparkline), and a stacked-bar
// time-series for "X by category" (StackedBars).

type SparkPoint = { day: string; value: number };

export function Sparkline({
  data,
  height = 64,
  stroke = "currentColor",
  fillOpacity = 0.12,
}: {
  data: SparkPoint[];
  height?: number;
  stroke?: string;
  fillOpacity?: number;
}) {
  if (data.length === 0) return <div className="h-16" />;
  const w = 600; // viewBox width — scales via preserveAspectRatio
  const h = height;
  const pad = 4;
  const xs = data.map((_, i) => (i / Math.max(1, data.length - 1)) * (w - pad * 2) + pad);
  const max = Math.max(1, ...data.map((d) => d.value));
  const ys = data.map((d) => h - pad - (d.value / max) * (h - pad * 2));

  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(" ");
  const area =
    `${path} L ${xs[xs.length - 1].toFixed(1)} ${h - pad} L ${xs[0].toFixed(1)} ${h - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: h }}
    >
      <path d={area} fill={stroke} opacity={fillOpacity} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} />
    </svg>
  );
}

type StackPoint = { day: string; values: Record<string, number> };

export function StackedBars({
  data,
  keys,
  colors,
  height = 140,
}: {
  data: StackPoint[];
  keys: string[];
  colors: Record<string, string>;
  height?: number;
}) {
  if (data.length === 0) return <div style={{ height }} />;
  const w = 600;
  const pad = 6;
  const barGap = 1;
  const barSlot = (w - pad * 2) / data.length;
  const barW = Math.max(1, barSlot - barGap);
  const max = Math.max(
    1,
    ...data.map((d) => keys.reduce((s, k) => s + (d.values[k] ?? 0), 0)),
  );

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {data.map((d, i) => {
        const x = pad + i * barSlot;
        let yCursor = height - pad;
        const segs: React.ReactNode[] = [];
        for (const k of keys) {
          const v = d.values[k] ?? 0;
          if (v <= 0) continue;
          const segH = (v / max) * (height - pad * 2);
          const y = yCursor - segH;
          segs.push(
            <rect
              key={k}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
              width={barW.toFixed(1)}
              height={segH.toFixed(1)}
              fill={colors[k] ?? "#94a3b8"}
            />,
          );
          yCursor = y;
        }
        return <g key={d.day}>{segs}</g>;
      })}
    </svg>
  );
}

// Inline legend chip used next to chart titles.
export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-500">
      <span
        className="inline-block w-2 h-2 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
