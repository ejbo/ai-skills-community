'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Fragment } from 'react';
import { EASE_OUT, isWhitespaceToken, splitTextTokens } from '@/lib/motion';

type Props = {
  text: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'div';
  /** `words` (default; CJK runs split per character) or `chars`. */
  by?: 'words' | 'chars';
  /** Seconds before the first token. */
  delay?: number;
  /** Seconds between tokens (default 0.045 for words, 0.02 for chars). */
  stagger?: number;
  className?: string;
};

// Staggered unblur + rise, once, when the heading enters the viewport.
// Whitespace tokens are emitted as plain text, so line wrapping stays native
// (no flex-wrap, no forced &nbsp;). The hidden start lives in the
// `whileInView` keyframes — server HTML is fully visible (house rule) and the
// reduced-motion branch renders an attribute-identical element.
// Headings only (≤ ~20 tokens): `filter: blur` promotes every span to its own
// layer. Body copy uses the existing `Reveal`.
export function BlurText({
  text,
  as: Tag = 'h1',
  by = 'words',
  delay = 0,
  stagger,
  className = '',
}: Props) {
  const reduce = useReducedMotion();
  const gap = stagger ?? (by === 'chars' ? 0.02 : 0.045);
  const tokens = splitTextTokens(text, by);
  let slot = 0; // whitespace tokens do not consume a stagger slot
  return (
    <Tag className={className} aria-label={text}>
      {tokens.map((token, i) => {
        if (isWhitespaceToken(token)) return <Fragment key={i}>{token}</Fragment>;
        const index = slot;
        slot += 1;
        return (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block will-change-[transform,opacity,filter]"
            whileInView={
              reduce ? undefined : { opacity: [0, 1], y: [10, 0], filter: ['blur(6px)', 'blur(0px)'] }
            }
            viewport={{ once: true, margin: '0px 0px -10% 0px' }}
            transition={{ duration: 0.6, delay: delay + index * gap, ease: EASE_OUT }}
          >
            {token}
          </motion.span>
        );
      })}
    </Tag>
  );
}
