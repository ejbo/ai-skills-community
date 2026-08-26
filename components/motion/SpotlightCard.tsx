'use client';

import type { PointerEvent, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  /** Radius of the light in px. */
  radius?: number;
  /** Peak alpha of the light. Keep ≤ 0.08 in dark, ≤ 0.06 in light — brighter reads as a glow. */
  alpha?: number;
  as?: 'div' | 'article';
};

// Mouse-tracked radial highlight in the card's own text colour (monochrome:
// `rgb(var(--text) / α)`, never a hue). Writes `--sx/--sy` on the element
// instead of setState, so a mousemove never re-renders the card's children —
// a grid of 30 zone cards stays free. Touch/pen pointers are ignored: the
// light would stick where the finger left. The light layer is decorative and
// starts at opacity 0 (CSS hover fades it in), so SSR content is unaffected.
export function SpotlightCard({
  children,
  className = '',
  radius = 360,
  alpha = 0.07,
  as = 'div',
}: Props) {
  const Tag = as;
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--sx', `${e.clientX - r.left}px`);
    el.style.setProperty('--sy', `${e.clientY - r.top}px`);
  };
  return (
    <Tag
      onPointerMove={onPointerMove}
      className={`group relative overflow-hidden rounded-xl border border-zinc-200 bg-white lit-edge dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          background: `radial-gradient(${radius}px circle at var(--sx, 50%) var(--sy, 50%), rgb(var(--text) / ${alpha}), transparent 65%)`,
        }}
      />
      <div className="relative">{children}</div>
    </Tag>
  );
}
