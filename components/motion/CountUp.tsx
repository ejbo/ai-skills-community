'use client';

import { animate, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';
import { EASE_OUT } from '@/lib/motion';

type Props = {
  value: number;
  /** Seconds; keep ≤ 1.2 — the tween never overshoots. */
  duration?: number;
  decimals?: number;
  /**
   * Explicit locale: an undefined locale formats differently on the server and
   * in the viewer's browser and trips hydration (homepage figures use en-US too).
   */
  locale?: string;
  suffix?: string;
  className?: string;
};

// Stat counter that tweens from the last painted figure to `value` the first
// time it scrolls into view (and again on every later `value` change). The
// frame loop writes the text node directly — no React re-render per frame.
// Server HTML, no-JS and reduced-motion all carry the final figure.
export function CountUp({
  value,
  duration = 1.2,
  decimals = 0,
  locale = 'en-US',
  suffix = '',
  className = '',
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0); // last value painted — later updates animate from here, not from 0
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduce = useReducedMotion();
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [locale, decimals],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    // Write into React's own text node when it is still there so React and the
    // DOM never disagree about which node carries the figure.
    const paint = (v: number) => {
      const text = fmt.format(v) + suffix;
      const node = el.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE && !node.nextSibling) node.nodeValue = text;
      else el.textContent = text;
    };
    if (reduce) {
      paint(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => {
        shown.current = v;
        paint(v);
      },
      onComplete: () => {
        shown.current = value;
        paint(value);
      },
    });
    return () => controls.stop();
  }, [inView, reduce, value, duration, fmt, suffix]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {`${fmt.format(value)}${suffix}`}
    </span>
  );
}
