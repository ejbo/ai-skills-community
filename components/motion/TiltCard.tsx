'use client';

import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';
import { SPRING_SOFT, useFinePointer } from '@/lib/motion';

type Props = {
  children: ReactNode;
  /** Max tilt in degrees (5 is restrained; reactbits' 14 is a toy). */
  max?: number;
  /** Hover scale (≤ 1.02 per the motion budget). */
  lift?: number;
  className?: string;
};

// 3D tilt following the pointer, fine-pointer + motion-safe only. Both SSR and
// client render the same node — `live` only gates the handlers and whileHover.
// The transform makes the card a containing block for `position: fixed`
// descendants (same trap as `.card-hover`): anything inside that opens a fixed
// overlay must portal (DeptTag's tooltip and ImageLightbox already do). Do not
// stack with `.card-hover`; pick one. Never on a grid of 20+ cards.
export function TiltCard({ children, max = 5, lift = 1.01, className = '' }: Props) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, SPRING_SOFT);
  const sy = useSpring(ry, SPRING_SOFT);
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const live = fine && !reduce;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!live) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const px = (e.clientX - r.left) / r.width - 0.5; // -0.5 … 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    rx.set(-py * max * 2);
    ry.set(px * max * 2);
  };
  const reset = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      // framer composes rotateX/rotateY/scale into one transform; perspective
      // rides on the element itself so no wrapper is needed.
      style={{ rotateX: sx, rotateY: sy, transformPerspective: 900 }}
      whileHover={live ? { scale: lift } : undefined}
      transition={{ type: 'spring', ...SPRING_SOFT }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}
