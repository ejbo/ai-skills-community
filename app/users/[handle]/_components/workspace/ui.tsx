// 工作台 building blocks. Server-safe (no hooks, no 'use client'): the whole tab
// renders on the server and ships no JS of its own — folding is a native
// <details>, jumping between sections is a plain #anchor.
//
// 配色契约: the chrome here is ink. The only hues are STATE the owner acts on
// (amber = waiting on you, the dots on a status line) and the material the rows
// are about (book spines, 版块 colours, vote covers, avatars).

import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { foldList } from '@/lib/profile/workspace';

/** Small ink-outline action on a row (管理 / 编辑 / 继续编辑). */
export const WS_ROW_BTN =
  'inline-flex h-7 shrink-0 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 ' +
  'transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 ' +
  'dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100';

/** "Waiting on you" pill — the one tinted element a row may carry. */
export const WS_ATTENTION_PILL =
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 text-[11px] font-medium text-amber-800 ' +
  'transition hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25';

export const WS_LIST = 'surface overflow-hidden rounded-2xl';
export const WS_ROWS = 'divide-y divide-zinc-100 dark:divide-zinc-800/70';
export const WS_ROW = 'transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40';
/** Title link inside a row: ink, underline on hover (the row itself is not a link). */
export const WS_TITLE_LINK =
  'min-w-0 truncate font-medium text-zinc-900 decoration-zinc-300 underline-offset-2 hover:underline ' +
  'dark:text-zinc-100 dark:decoration-zinc-600';

export function WsSection({
  id,
  icon: Icon,
  title,
  count,
  extra,
  link,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  count?: number;
  /** Beside the title (e.g. 有更新 summary). */
  extra?: ReactNode;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    // scroll-mt clears the sticky navbar when a stat tile jumps here.
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-3 border-b border-zinc-200/90 pb-2.5 dark:border-zinc-800">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 id={headingId} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Icon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
            {title}
          </h2>
          {count !== undefined && (
            <span className="font-mono text-xs tabular-nums text-muted">{count}</span>
          )}
          {extra}
        </div>
        {link && (
          <Link
            href={link.href}
            className="group mb-px flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {link.label}
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A list that shows its first rows and folds the rest behind a native
 * <details> (no client JS, works before hydration, keyboard-accessible).
 */
export function WsFoldList<T>({
  items,
  visible,
  moreLabel,
  lessLabel,
  renderItem,
}: {
  items: readonly T[];
  visible: number;
  moreLabel: string;
  lessLabel: string;
  renderItem: (item: T) => ReactNode;
}) {
  const { shown, rest } = foldList(items, visible);
  return (
    <div className={WS_LIST}>
      <ul className={WS_ROWS}>{shown.map(renderItem)}</ul>
      {rest.length > 0 && (
        <details className="group/fold border-t border-zinc-100 dark:border-zinc-800/70">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-100 [&::-webkit-details-marker]:hidden">
            <span className="group-open/fold:hidden">{moreLabel}</span>
            <span className="hidden group-open/fold:inline">{lessLabel}</span>
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform duration-200 group-open/fold:rotate-180"
              aria-hidden
            />
          </summary>
          <ul className={`${WS_ROWS} border-t border-zinc-100 dark:border-zinc-800/70`}>{rest.map(renderItem)}</ul>
        </details>
      )}
    </div>
  );
}

/** Compact empty state — a workspace full of big empty boxes reads as a failure, not a start. */
export function WsEmpty({ hint, cta }: { hint: string; cta?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-dashed border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
      <p className="text-sm text-muted">{hint}</p>
      {cta && (
        <Link
          href={cta.href}
          className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/** `● 已发布` — a dot + muted label; quieter than a pill on every row. */
export function WsStatusDot({ tone, label }: { tone: 'ok' | 'wait' | 'bad' | 'off'; label: string }) {
  const dot =
    tone === 'ok'
      ? 'bg-emerald-500'
      : tone === 'wait'
        ? 'bg-amber-500'
        : tone === 'bad'
          ? 'bg-red-500'
          : 'bg-zinc-400 dark:bg-zinc-500';
  const text = tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-muted';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
