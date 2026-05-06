"use client";

import { useEffect, useRef } from "react";

/**
 * Cursor-tracking radial glow over a faded grid backdrop.
 * Two stacked layers: dotted/grid base + warm spotlight that follows the mouse.
 * Designed to sit absolutely behind hero-class sections.
 */
export default function GridSpotlight({
  className = "",
}: {
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--x", `${x}px`);
        el.style.setProperty("--y", `${y}px`);
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 m-grid-bg" />
      <div className="absolute inset-0 m-spotlight" />
      <div className="m-orb m-orb-coral" style={{ width: 520, height: 520, left: "12%", top: "-10%" }} />
      <div className="m-orb m-orb-amber" style={{ width: 460, height: 460, right: "8%", top: "20%" }} />
    </div>
  );
}
