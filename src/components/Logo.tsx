export default function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* M-shape connector path */}
      <path d="M25 72 L25 40 L50 62 L75 40 L75 72" />
      {/* top-center spur */}
      <path d="M50 62 L50 32" />
      {/* tick marks in the two notches */}
      <path d="M36 52 L36 60" />
      <path d="M64 52 L64 60" />
      {/* nodes — fill with current bg so the stroke passes behind them */}
      <circle cx="25" cy="40" r="8" fill="rgb(var(--c-paper))" />
      <circle cx="50" cy="24" r="8" fill="rgb(var(--c-paper))" />
      <circle cx="75" cy="40" r="8" fill="rgb(var(--c-paper))" />
      <circle cx="25" cy="80" r="8" fill="rgb(var(--c-paper))" />
      <circle cx="75" cy="80" r="8" fill="rgb(var(--c-paper))" />
    </svg>
  );
}
