'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { DescriptionModal } from '@/components/video/DescriptionModal';

const COLLAPSED_MAX_PX = 220;

// YouTube-style description: collapsed by default when long, with a Show
// more/less toggle, plus a maximize button that opens it full-screen in a modal
// to read focused (mirrors the AI panel's expand affordance).
export function VideoDescription({ content }: { content: string }) {
  const t = useTranslations('video');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) setOverflowing(el.scrollHeight > COLLAPSED_MAX_PX + 8);
  }, [content]);

  const collapsed = !expanded && overflowing;

  return (
    <div className="surface rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t('detail.description')}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('detail.expand')}
          title={t('detail.expand')}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div className="relative">
        <div
          ref={bodyRef}
          className={collapsed ? 'overflow-hidden' : ''}
          style={collapsed ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
        >
          <MarkdownRenderer content={content} compact />
        </div>
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
        )}
      </div>

      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              {t('detail.collapse')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              {t('detail.expand')}
            </>
          )}
        </button>
      )}

      <DescriptionModal
        open={open}
        onClose={() => setOpen(false)}
        title={t('detail.description')}
        content={content}
      />
    </div>
  );
}
