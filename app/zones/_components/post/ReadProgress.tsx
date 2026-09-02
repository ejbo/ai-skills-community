'use client';

// 1 px reading-progress hairline (M10): how far through the ARTICLE the reader
// is, drawn as a zinc-400 line growing down the TOC's left rule (wide rail) or
// the strip's left edge (narrow rail). Progress 0 = the article's top sits on
// the 112 px reading line (the same line PostToc uses to pick the active
// heading, so the hairline reaches a section's top exactly when its entry
// lights up); 1 = the article's end has met the viewport bottom — i.e. the
// `['start 112px', 'end end']` offsets, computed by hand from `scrollY` +
// the article's measured geometry (ResizeObserver + resize) rather than
// framer's `useScroll({ target })`: with the window as the scroll container
// framer 11 warns on every dev page load ("container has a static position")
// while measuring exactly this. A spring smooths the value; reduced motion
// reads the raw progress (still tracks, no spring). Server and first client
// render both paint `scaleY(0)`.

import { useEffect, type RefObject } from 'react';
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { useTranslations } from 'next-intl';

/** Where the article "starts" for the progress line — PostToc's reading line. */
export const READ_PROGRESS_TOP_PX = 112;

const PROGRESS_SPRING = { stiffness: 300, damping: 40 } as const;

/**
 * Progress 0…1 for scroll position `y` over an article at document offset
 * `top` with `height`, in a viewport `viewportH` tall: 0 when the article's
 * top is at `offset` px, 1 when its end meets the viewport bottom. An article
 * shorter than the window is either unread (0) or read (1). Pure — pinned by
 * tests/zones-toc-offset.test.ts.
 */
export function readProgress(y: number, top: number, height: number, viewportH: number, offset = READ_PROGRESS_TOP_PX): number {
  const start = top - offset;
  const end = top + height - viewportH;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) return y >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (y - start) / (end - start)));
}

export function ReadProgress({
  target,
  left = '-left-px',
  className = '',
}: {
  target: RefObject<HTMLElement>;
  /** Horizontal anchor class — `-left-px` sits ON a sibling's 1 px left border, `left-0` on the host's own edge. */
  left?: string;
  className?: string;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const raw = useMotionValue(0);
  const smooth = useSpring(raw, PROGRESS_SPRING);
  const scaleY = reduce ? raw : smooth;

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let top = 0;
    let height = 0;
    const update = () => raw.set(readProgress(window.scrollY, top, height, window.innerHeight));
    const measure = () => {
      const r = el.getBoundingClientRect();
      top = r.top + window.scrollY;
      height = r.height;
      update();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    const unsubscribe = scrollY.on('change', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      unsubscribe();
    };
  }, [target, raw, scrollY]);

  return (
    <span aria-hidden title={t('post_progress_aria')} className={`pointer-events-none absolute inset-y-0 w-px overflow-hidden ${left} ${className}`}>
      <motion.span style={{ scaleY, transformOrigin: 'top' }} className="block h-full w-px bg-zinc-400 dark:bg-zinc-500" />
    </span>
  );
}
