"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a numeric stat up from 0 the first time it enters the viewport.
 * `value` may carry non-numeric prefix/suffix (e.g. "×3", "5 דק'", "99.9%"),
 * which is preserved; only the number animates. Non-numeric values (e.g.
 * "24/7") are rendered as-is.
 */
export function CountUp({ value, className = "" }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const match = value.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/s);
    // Animate only when there's exactly one number and no other digits elsewhere.
    const digitGroups = value.match(/\d+(?:\.\d+)?/g) || [];
    if (!match || digitGroups.length !== 1) {
      setDisplay(value);
      return;
    }

    const [, prefix, numStr, suffix] = match;
    const target = parseFloat(numStr);
    const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setDisplay(value);
      return;
    }

    setDisplay(`${prefix}0${suffix}`);

    let raf = 0;
    let start = 0;
    const duration = 1400;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const tick = (t: number) => {
          if (!start) start = t;
          const p = Math.min(1, (t - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          const cur = (target * eased).toFixed(decimals);
          setDisplay(`${prefix}${cur}${suffix}`);
          if (p < 1) raf = requestAnimationFrame(tick);
          else setDisplay(value);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
