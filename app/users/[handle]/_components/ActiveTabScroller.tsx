'use client';

// Keeps the active profile tab visible inside the horizontally scrolling tab
// bar. With up to 13 tabs a phone shows three, so landing on `?tab=shelf`
// (a shared link, a figure tapped in the hero) would otherwise leave the
// selected tab off-screen. Only the bar's own `scrollLeft` moves — never
// `scrollIntoView`, which would also scroll the page vertically.

import { useEffect, useRef, type ReactNode } from 'react';

export function ActiveTabScroller({
  active,
  className,
  children,
}: {
  active: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current?.querySelector<HTMLElement>('nav, [role="tablist"]');
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]');
    if (!bar || !current || bar.scrollWidth <= bar.clientWidth) return;
    const target = current.offsetLeft - (bar.clientWidth - current.offsetWidth) / 2;
    bar.scrollLeft = Math.max(0, Math.min(target, bar.scrollWidth - bar.clientWidth));
  }, [active]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
