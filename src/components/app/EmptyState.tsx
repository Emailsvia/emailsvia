"use client";

/**
 * Empty state used for "no campaigns yet", "no replies", etc. Glass card
 * with an icon, headline, body, and an optional action.
 */
export default function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center rounded-2xl border border-dashed border-ink-200 bg-surface/40 px-6 py-16">
      {icon && (
        <div
          className="mx-auto grid place-items-center w-12 h-12 rounded-xl mb-4 border"
          style={{
            borderColor: "rgb(255 99 99 / 0.20)",
            background: "rgb(255 99 99 / 0.06)",
            color: "rgb(255 140 140)",
          }}
        >
          {icon}
        </div>
      )}
      <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
      {body && (
        <p className="text-[13.5px] text-ink-600 mt-2 max-w-sm mx-auto leading-relaxed">{body}</p>
      )}
      {action && <div className="mt-5 inline-flex">{action}</div>}
    </div>
  );
}
