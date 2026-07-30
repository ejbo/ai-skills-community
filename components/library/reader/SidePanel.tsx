'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Inline reader side panel: on lg+ it participates in the flex row, PUSHING
 * the reading column aside (no dark overlay — the text stays readable and
 * multiple panels can be open at once). Below lg it floats over the content
 * as a light sheet, still without a backdrop.
 */
export function SidePanel({
  side,
  title,
  onClose,
  children,
  headerExtra,
  widthClass = 'lg:w-[340px]',
}: {
  side: 'left' | 'right';
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  headerExtra?: ReactNode;
  widthClass?: string;
}) {
  const tc = useTranslations('common');
  const sideCls =
    side === 'left'
      ? 'max-lg:left-0 lg:border-r'
      : 'max-lg:right-0 lg:border-l';
  return (
    <aside
      className={`reader-panel rborder flex h-full min-h-0 flex-col overflow-hidden max-lg:absolute max-lg:inset-y-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[400px] max-lg:shadow-2xl lg:relative lg:shrink-0 ${sideCls} ${widthClass} animate-fade-in`}
    >
      <div className="rborder flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {headerExtra}
        <button
          type="button"
          onClick={onClose}
          aria-label={tc('dismiss')}
          className="r-muted grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </aside>
  );
}
