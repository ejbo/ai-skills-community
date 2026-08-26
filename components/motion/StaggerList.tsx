'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { EASE_OUT } from '@/lib/motion';

type StaggerGridProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  /** Layout classes for the list, e.g. "grid gap-4 sm:grid-cols-2 lg:grid-cols-3". */
  className?: string;
  itemClassName?: string;
  /** Seconds between the first `cascade` items. */
  stagger?: number;
  /** Items beyond this enter with no delay (they scroll in one by one). */
  cascade?: number;
};

// Server-rendered grid/list whose items rise in once as they scroll into view
// (the first `cascade` items cascade, the rest reveal individually). The
// hidden start lives in the `whileInView` keyframes — server HTML is fully
// visible, and both reduced-motion branches render an attribute-identical
// <li>. No `scale` (playful), no edge fades (a list scrolling in its own box
// gets `.scroll-thin` + a mask-image on the scroller instead). Keyboard nav is
// left to native focus order — never preventDefault Tab.
export function StaggerGrid<T>({
  items,
  keyOf,
  render,
  className = '',
  itemClassName = '',
  stagger = 0.05,
  cascade = 8,
}: StaggerGridProps<T>) {
  const reduce = useReducedMotion();
  return (
    <ul className={className}>
      {items.map((item, i) => (
        <motion.li
          key={keyOf(item)}
          className={itemClassName}
          whileInView={reduce ? undefined : { opacity: [0, 1], y: [12, 0] }}
          viewport={{ once: true, margin: '0px 0px -8% 0px' }}
          transition={{ duration: 0.45, delay: i < cascade ? i * stagger : 0, ease: EASE_OUT }}
        >
          {render(item, i)}
        </motion.li>
      ))}
    </ul>
  );
}

type LiveListProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  className?: string;
  itemClassName?: string;
};

// Client-side mutations (a comment just posted / deleted) MAY use `initial`:
// `AnimatePresence initial={false}` skips it for everything present on first
// mount, so nothing server-rendered starts hidden. `layout` slides the
// neighbours into the gap; exit collapses the row's height.
export function LiveList<T>({ items, keyOf, render, className = '', itemClassName = '' }: LiveListProps<T>) {
  const reduce = useReducedMotion();
  return (
    <ul className={className}>
      <AnimatePresence initial={false}>
        {items.map((item, i) => (
          <motion.li
            key={keyOf(item)}
            className={itemClassName}
            layout={!reduce}
            initial={{ opacity: 0, y: reduce ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, overflow: 'hidden' }}
            transition={{ duration: reduce ? 0 : 0.25, ease: EASE_OUT }}
          >
            {render(item, i)}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
