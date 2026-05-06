"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fades + lifts children into view when they enter the viewport.
 * Stagger via delayMs. Honors prefers-reduced-motion via the .m-reveal CSS.
 */
export default function Reveal({
  children,
  delayMs = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const Component = Tag as React.ElementType;
  return (
    <Component
      ref={ref as React.Ref<HTMLElement>}
      className={`m-reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ ["--m-delay" as string]: `${delayMs}ms` }}
    >
      {children}
    </Component>
  );
}
