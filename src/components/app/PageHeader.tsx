"use client";

/**
 * Standard page header for /app/* pages. Eyebrow + title + subtitle on the
 * left, action slot on the right. Bottom hairline separates from content.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row pb-6 mb-6 border-b border-ink-200">
      <div className="min-w-0">
        {eyebrow && (
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 mb-2">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] text-ink leading-[1.05]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13.5px] text-ink-600 mt-1.5 max-w-xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </header>
  );
}
