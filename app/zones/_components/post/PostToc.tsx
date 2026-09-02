'use client';

// Right-rail table of contents: the server's `post.headings`
// (extractHeadings) rendered as a vertical TabBar; the active entry follows
// the reading position through ONE IntersectionObserver over the heading
// elements (ids assigned by ZoneMarkdown — it fires ZONE_HEADINGS_READY_EVENT,
// so the observer (re)binds after every body render). Clicking scrolls
// smoothly (headings carry `scroll-mt-*`) and updates the URL hash.
//
// The reading-progress hairline (ReadProgress) grows down the TabBar's left
// rule from the same 112 px reading line, so the line reaches a section's top
// exactly when its entry lights up. TOP_OFFSET_PX stays 112: the navbar is
// held VISIBLE while a file is docked, so the 68 px budget never changes.

import { useEffect, useState, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { TabBar } from '@/components/motion';
import type { MdHeading } from '@/lib/zones/shared';
import { ZONE_HEADINGS_READY_EVENT } from '@/components/zones/ZoneMarkdown';
import { FADE_Y_CLASS } from '../ui';
import { ReadProgress } from './ReadProgress';

export const TOP_OFFSET_PX = 112;

/**
 * The entry the reader is in: the LAST heading whose top has passed the
 * reading line; before any has, the first one. Entries come in document
 * order. Pure — pinned by tests/zones-toc-offset.test.ts.
 */
export function activeHeadingFor(entries: readonly { id: string; top: number }[], offset = TOP_OFFSET_PX): string {
  let current = entries[0]?.id ?? '';
  for (const e of entries) {
    if (e.top <= offset) current = e.id;
    else break;
  }
  return current;
}

export function PostToc({
  headings,
  articleRef,
  className = '',
}: {
  headings: MdHeading[];
  /** The article element — drives the reading-progress hairline. */
  articleRef?: RefObject<HTMLElement>;
  className?: string;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const [active, setActive] = useState<string>(headings[0]?.id ?? '');

  useEffect(() => {
    if (headings.length === 0) return;
    let observer: IntersectionObserver | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const recompute = (els: HTMLElement[]) => {
      const current = activeHeadingFor(els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })));
      setActive((prev) => (prev === current ? prev : current));
    };

    const bind = () => {
      observer?.disconnect();
      const els = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el instanceof HTMLElement);
      if (els.length === 0) {
        if (retries++ < 12) retryTimer = setTimeout(bind, 150);
        return;
      }
      observer = new IntersectionObserver(() => recompute(els), {
        rootMargin: `-${TOP_OFFSET_PX}px 0px -55% 0px`,
        threshold: [0, 1],
      });
      els.forEach((el) => observer?.observe(el));
      recompute(els);
    };

    bind();
    window.addEventListener(ZONE_HEADINGS_READY_EVENT, bind);
    return () => {
      observer?.disconnect();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener(ZONE_HEADINGS_READY_EVENT, bind);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  const tabs = headings.map((h) => ({
    key: h.id,
    label: <span className={`block truncate ${h.level >= 3 ? 'pl-4 text-[13px]' : h.level === 2 ? 'pl-1' : 'font-medium'}`}>{h.text}</span>,
  }));

  return (
    <nav className={className} aria-label={t('post_toc')}>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_toc')}</h3>
      {/* The mask fades scrolled-out entries at both edges; the inner padding
          keeps the resting first/last rows clear of the fade. The hairline is
          a sibling of the scroller (an absolute child INSIDE a scroll container
          would scroll away with the content). */}
      <div className={`relative ${FADE_Y_CLASS}`}>
        <TabBar
          id="post-toc"
          orientation="vertical"
          ariaLabel={t('post_toc')}
          tabs={tabs}
          active={active}
          onSelect={(key) => {
            const el = document.getElementById(key);
            if (!el) return;
            el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            try {
              history.replaceState(null, '', `#${key}`);
            } catch {
              /* ignore */
            }
            setActive(key);
          }}
          className="max-h-[50vh] overflow-y-auto scroll-thin pb-6 pt-3 text-sm"
        />
        {articleRef && <ReadProgress target={articleRef} left="left-0" />}
      </div>
    </nav>
  );
}
