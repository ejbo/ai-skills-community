'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';
import { clamp, useFinePointer } from '@/lib/motion';

type Props = {
  children: ReactNode;
  /** Fraction of the pointer offset applied (0.2 = one fifth). */
  strength?: number;
  /** Hard cap in px — 6 is the professional ceiling. */
  max?: number;
  className?: string;
};

// Bounded pull toward the cursor for ONE primary CTA per surface (never on
// list rows). Fine-pointer users only: touch and reduced-motion get a static
// element. The OUTER box is the hit area and never moves, so the pull cannot
// chase the pointer out from under itself; `-m-2 p-2` extends the field 8px
// past the button. Listening here instead of on `window` keeps a page with
// several buttons cheap.
export function Magnetic({ children, strength = 0.2, max = 6, className = '' }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 320, damping: 22, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 320, damping: 22, mass: 0.5 });
  const fine = useFinePointer(); // both hooks are called unconditionally —
  const reduce = useReducedMotion(); // never `useFinePointer() && !useReducedMotion()`
  const live = fine && !reduce;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!live) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set(clamp((e.clientX - (r.left + r.width / 2)) * strength, max));
    y.set(clamp((e.clientY - (r.top + r.height / 2)) * strength, max));
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div
      className={`-m-2 inline-block p-2 ${className}`}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      <motion.div style={{ x: sx, y: sy }} className="inline-block">
        {children}
      </motion.div>
    </div>
  );
}
