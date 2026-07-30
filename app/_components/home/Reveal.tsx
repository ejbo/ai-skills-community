'use client';

// Scroll-reveal wrapper for homepage sections: content fades/rises in the
// first time it enters the viewport. Above-the-fold entrances use the CSS
// `animate-rise` utility instead (visible without JS); this one is for
// content the user scrolls to.
//
// Two constraints shape the implementation — don't "simplify" them away:
// 1. No `initial` prop: framer would SSR it as inline `opacity:0`, leaving
//    everything invisible when JS fails or hydration is slow. The hidden
//    start state lives in the whileInView keyframes instead, so server HTML
//    is always visible.
// 2. Both branches must render an attribute-identical <motion.div>:
//    useReducedMotion() is null on the server, and React 18 hydration never
//    patches attribute mismatches — an early-return <div> here left the SSR
//    style stuck at opacity:0 for reduced-motion users.

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileInView={reduceMotion ? undefined : { opacity: [0, 1], y: [20, 0] }}
      viewport={{ once: true, margin: '0px 0px -48px 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
