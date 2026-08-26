'use client';

// Right-rail table of contents: the server's `post.headings`
// (extractHeadings) rendered as a vertical TabBar; the active entry follows
// the reading position through ONE IntersectionObserver over the heading
// elements (ids assigned by ZoneMarkdown — it fires ZONE_HEADINGS_READY_EVENT,
// so the observer (re)binds after every body render). Clicking scrolls
// smoothly (headings carry `scroll-mt-*`) and updates the URL hash.

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { TabBar } from '@/components/motion';
import type { MdHeading } from '@/lib/zones/shared';
import { ZONE_HEADINGS_READY_EVENT } from '@/components/zones/ZoneMarkdown';

const TOP_OFFSET_PX = 112;

export function PostToc({ headings, className = '' }: { headings: MdHeading[]; className?: string }) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const [active, setActive] = useState<string>(headings[0]?.id ?? '');

  useEffect(() => {
    if (headings.length === 0) return;
    let observer: IntersectionObserver | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const recompute = (els: HTMLElement[]) => {
      // The last heading whose top has passed the reading line is the section
      // the reader is in; before any has, the first heading is active.
      let current = els[0]?.id ?? '';
      for (const el of els) {
        if (el.getBoundingClientRect().top <= TOP_OFFSET_PX) current = el.id;
        else break;
      }
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
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_toc')}</h3>
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
        className="max-h-[50vh] overflow-y-auto scroll-thin text-sm"
      />
    </nav>
  );
}
