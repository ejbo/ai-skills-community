'use client';

// Wraps rendered markdown whose `[12:34]` stamps were turned into `#t=<seconds>`
// links (lib/video/timestamps.ts linkifyStamps). ONE delegated click handler
// turns a click on any of them into a seek request on the watch bus — so it
// works identically under the site's sanitising MarkdownRenderer (summary) and
// the light ReactMarkdown the chat streams into, with no per-link component and
// no sanitizer exception (a fragment href is already allowed).

import type { MouseEvent, ReactNode } from 'react';
import { seekSecondsFromHref } from '@/lib/video/timestamps';
import { requestSeek } from './watch-bus';

export function SeekLinks({ children, className }: { children: ReactNode; className?: string }) {
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
    const sec = seekSecondsFromHref(link?.getAttribute('href'));
    if (sec === null) return;
    e.preventDefault();
    requestSeek(sec);
  }
  return (
    // The links are styled as timestamps (mono, no wrap) wherever they appear inside.
    <div
      onClick={onClick}
      className={`[&_a[href*='#t=']]:whitespace-nowrap [&_a[href*='#t=']]:rounded [&_a[href*='#t=']]:bg-zinc-900/[0.06] [&_a[href*='#t=']]:px-1 [&_a[href*='#t=']]:py-px [&_a[href*='#t=']]:font-mono [&_a[href*='#t=']]:text-[0.92em] [&_a[href*='#t=']]:tabular-nums [&_a[href*='#t=']]:no-underline hover:[&_a[href*='#t=']]:bg-zinc-900/[0.12] dark:[&_a[href*='#t=']]:bg-white/10 dark:hover:[&_a[href*='#t=']]:bg-white/20 ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
