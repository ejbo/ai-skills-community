'use client';

// Grouped list of attachments (images → videos → files) as AttachmentCards —
// the READING page's panel. The composer's LEDGER is deliberately not this
// component: its rows animate through `LiveList` (M21) and stay in insertion
// order, so AttachmentUploader renders them itself. A trailing per-row `extra`
// slot used to live here for that ledger and never had a caller; it was
// removed rather than left to suggest otherwise.
//
// Counts are unlimited now, so the list WINDOWS itself: the first WINDOW rows
// render, an IntersectionObserver sentinel appends the next WINDOW (the votes
// gallery pattern — DOM count, not payload, is the cost), and every row is
// `.cv-auto`. `limitPerGroup` is the reading-page variant: N rows per group
// and a <details> 「还有 {count} 个」 for the rest.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentCard, attachmentPreviewRef } from './AttachmentCard';

const WINDOW = 48;

type Row = { item: ZoneAttachmentView; index: number };

export function AttachmentList({
  items,
  onRemove,
  compact = false,
  className = '',
  activeRef = null,
  onOpenItem,
  limitPerGroup,
}: {
  items: ZoneAttachmentView[];
  /** Remove by index in `items` (the reading panel passes none). */
  onRemove?: (index: number) => void;
  compact?: boolean;
  className?: string;
  /** The row open in the preview panel — matches `attachment.id` OR its storage key. */
  activeRef?: string | null;
  /** Override the card's default open; `via` = 'keyboard' when the click had event.detail === 0. */
  onOpenItem?: (item: ZoneAttachmentView, index: number, via?: 'pointer' | 'keyboard') => void;
  /** Render N per group + a 「还有 {count} 个」 disclosure for the rest. */
  limitPerGroup?: number;
}) {
  const t = useTranslations('zones');
  const [shown, setShown] = useState(WINDOW);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const windowed = limitPerGroup == null && items.length > shown;
  useEffect(() => {
    if (!windowed) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + WINDOW);
      },
      { rootMargin: '240px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [windowed, shown]);

  if (items.length === 0) return null;

  const groups: { key: 'image' | 'video' | 'file'; label: string; rows: Row[] }[] = [
    { key: 'image', label: t('attach_group_images'), rows: [] },
    { key: 'video', label: t('attach_group_videos'), rows: [] },
    { key: 'file', label: t('attach_group_files'), rows: [] },
  ];
  const visible = limitPerGroup == null ? items.slice(0, shown) : items;
  visible.forEach((item, index) => {
    const g = groups.find((x) => x.key === item.kind) ?? groups[2];
    g.rows.push({ item, index });
  });

  const isActive = (item: ZoneAttachmentView) => {
    if (!activeRef) return false;
    return (item.id !== '' && item.id === activeRef) || attachmentPreviewRef(item) === activeRef;
  };

  const renderRow = ({ item, index }: Row) => (
    <li key={item.id || `${item.url}:${index}`} className="cv-auto">
      <AttachmentCard
        attachment={item}
        compact={compact}
        active={isActive(item)}
        onRemove={onRemove ? () => onRemove(index) : undefined}
        onOpen={onOpenItem ? (via) => onOpenItem(item, index, via) : undefined}
      />
    </li>
  );

  const listCls = compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-2';

  return (
    <div className={`space-y-3 ${className}`}>
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => {
          const head = limitPerGroup != null ? g.rows.slice(0, limitPerGroup) : g.rows;
          const rest = limitPerGroup != null ? g.rows.slice(limitPerGroup) : [];
          return (
            <section key={g.key}>
              <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {g.label}
                <span className="font-mono tabular-nums">{g.rows.length}</span>
              </h4>
              <ul className={listCls}>{head.map(renderRow)}</ul>
              {rest.length > 0 && (
                <details className="group/more mt-1.5">
                  <summary className="cursor-pointer select-none list-none text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100">
                    {t('attach_more', { count: rest.length })}
                  </summary>
                  <ul className={`mt-1.5 ${listCls}`}>{rest.map(renderRow)}</ul>
                </details>
              )}
            </section>
          );
        })}
      {windowed && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </div>
  );
}
