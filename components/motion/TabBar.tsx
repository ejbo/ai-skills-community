'use client';

import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useState, type FocusEvent, type ReactNode } from 'react';
import { SPRING_SNAPPY } from '@/lib/motion';

export type TabItem = {
  key: string;
  label: ReactNode;
  /** Link tab (soft navigation, `scroll={false}`). Omit for a button tab driven by `onSelect`. */
  href?: string;
  count?: number;
  icon?: ReactNode;
};

type Props = {
  tabs: TabItem[];
  /** Key of the active tab — from the RSC (pathname / searchParams) or client state. */
  active: string;
  /** Scopes the layoutIds so two bars on one page never trade indicators. */
  id: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  /** Called for tabs without `href` (and also for link tabs, after navigation starts). */
  onSelect?: (key: string) => void;
  /** Accessible name of the bar — pass a translated string. */
  ariaLabel?: string;
  /** Link tabs only: let Next scroll on navigation (default false, e.g. for `?tab=` switches). */
  scroll?: boolean;
};

// Dock-like tabs with a 1px hairline indicator that SLIDES to the new tab
// (the bar stays mounted across soft navigations) and a hover pill that
// follows the pointer. `vertical` puts the hairline on the LEFT — the TOC rail
// in the post detail. Filled pills are what reads as "AI": the indicator stays
// a hairline. Reduced motion: the indicator jumps (duration 0).
export function TabBar({
  tabs,
  active,
  id,
  className = '',
  orientation = 'horizontal',
  onSelect,
  ariaLabel,
  scroll = false,
}: Props) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const spring = reduce ? { duration: 0 } : SPRING_SNAPPY;
  const vertical = orientation === 'vertical';
  const allLinks = tabs.every((t) => Boolean(t.href));

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
  };

  const containerClass = vertical
    ? `relative flex flex-col gap-0.5 border-l border-zinc-200 dark:border-zinc-800 ${className}`
    : `relative flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 ${className}`;
  const tabClass = (on: boolean) =>
    `relative shrink-0 whitespace-nowrap text-sm transition-colors ${
      vertical ? 'px-3 py-1.5 text-left' : 'px-3 py-2'
    } ${
      on
        ? 'text-zinc-900 dark:text-zinc-50'
        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
    }`;
  const pillClass = vertical
    ? 'absolute inset-x-1 inset-y-0 rounded-md bg-zinc-100 dark:bg-zinc-800/70'
    : 'absolute inset-x-0 inset-y-1 rounded-md bg-zinc-100 dark:bg-zinc-800/70';
  const indicatorClass = vertical
    ? 'absolute inset-y-1 -left-px w-px bg-zinc-900 dark:bg-zinc-50'
    : 'absolute inset-x-2 -bottom-px h-px bg-zinc-900 dark:bg-zinc-50';

  const inner = (t: TabItem, on: boolean) => (
    <>
      {hover === t.key && (
        <motion.span layoutId="hover" aria-hidden transition={spring} className={pillClass} />
      )}
      <span className="relative z-[1] inline-flex items-center gap-1.5">
        {t.icon}
        {t.label}
        {t.count != null && (
          <span className="font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">{t.count}</span>
        )}
      </span>
      {on && <motion.span layoutId="indicator" aria-hidden transition={spring} className={indicatorClass} />}
    </>
  );

  const children = tabs.map((t) => {
    const on = t.key === active;
    if (t.href) {
      return (
        <Link
          key={t.key}
          href={t.href}
          scroll={scroll}
          aria-current={on ? 'page' : undefined}
          onPointerEnter={() => setHover(t.key)}
          onFocus={() => setHover(t.key)}
          onClick={() => onSelect?.(t.key)}
          className={tabClass(on)}
        >
          {inner(t, on)}
        </Link>
      );
    }
    return (
      <button
        key={t.key}
        type="button"
        role={allLinks ? undefined : 'tab'}
        aria-selected={allLinks ? undefined : on}
        aria-current={allLinks ? (on ? 'page' : undefined) : undefined}
        onPointerEnter={() => setHover(t.key)}
        onFocus={() => setHover(t.key)}
        onClick={() => onSelect?.(t.key)}
        className={tabClass(on)}
      >
        {inner(t, on)}
      </button>
    );
  });

  return (
    <LayoutGroup id={id}>
      {allLinks ? (
        <nav aria-label={ariaLabel} className={containerClass} onPointerLeave={() => setHover(null)} onBlur={onBlur}>
          {children}
        </nav>
      ) : (
        <div
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          className={containerClass}
          onPointerLeave={() => setHover(null)}
          onBlur={onBlur}
        >
          {children}
        </div>
      )}
    </LayoutGroup>
  );
}
