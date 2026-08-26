'use client';

import { useTranslations } from 'next-intl';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentCard } from './AttachmentCard';

/** Grouped list of attachments (images → videos → files) as AttachmentCards. */
export function AttachmentList({
  items,
  onRemove,
  compact = false,
  className = '',
}: {
  items: ZoneAttachmentView[];
  /** Composer: remove by index in `items`. */
  onRemove?: (index: number) => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('zones');
  if (items.length === 0) return null;
  const groups: { key: 'image' | 'video' | 'file'; label: string; rows: { item: ZoneAttachmentView; index: number }[] }[] = [
    { key: 'image', label: t('attach_group_images'), rows: [] },
    { key: 'video', label: t('attach_group_videos'), rows: [] },
    { key: 'file', label: t('attach_group_files'), rows: [] },
  ];
  items.forEach((item, index) => {
    const g = groups.find((x) => x.key === item.kind) ?? groups[2];
    g.rows.push({ item, index });
  });

  return (
    <div className={`space-y-3 ${className}`}>
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <section key={g.key}>
            <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {g.label}
              <span className="font-mono tabular-nums">{g.rows.length}</span>
            </h4>
            <ul className={compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-2'}>
              {g.rows.map(({ item, index }) => (
                <li key={item.id || `${item.url}:${index}`}>
                  <AttachmentCard attachment={item} compact={compact} onRemove={onRemove ? () => onRemove(index) : undefined} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
