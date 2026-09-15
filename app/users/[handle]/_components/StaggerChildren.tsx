'use client';

// StaggerGrid for SERVER children. The motion kit's StaggerGrid takes a
// `render` function, which an RSC cannot pass across the client boundary — and
// several profile cards (EventCard, VoteCard) are async server components that
// must render on the server anyway. Same choreography as StaggerGrid: the hidden
// start lives in the `whileInView` keyframes (server HTML fully visible), both
// reduced-motion branches render an attribute-identical <li>, no scale.

import { motion, useReducedMotion } from 'framer-motion';
import { Children, isValidElement, type ReactNode } from 'react';
import { EASE_OUT } from '@/lib/motion';

export function StaggerChildren({
  children,
  className = '',
  itemClassName = '',
  stagger = 0.05,
  cascade = 9,
}: {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
  stagger?: number;
  cascade?: number;
}) {
  const reduce = useReducedMotion();
  const items = Children.toArray(children);
  return (
    <ul className={className}>
      {items.map((child, i) => (
        <motion.li
          key={isValidElement(child) && child.key != null ? child.key : i}
          className={itemClassName}
          whileInView={reduce ? undefined : { opacity: [0, 1], y: [12, 0] }}
          viewport={{ once: true, margin: '0px 0px -8% 0px' }}
          transition={{ duration: 0.45, delay: i < cascade ? i * stagger : 0, ease: EASE_OUT }}
        >
          {child}
        </motion.li>
      ))}
    </ul>
  );
}
