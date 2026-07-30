'use client';

import { useTranslations } from 'next-intl';
import { SidePanel } from './SidePanel';

export interface TocEntry {
  chapterIndex: number;
  title: string | null;
  charCount: number;
  /** ≤120 字 AI 章节摘要 (null until the doc is AI-indexed). */
  aiSummary: string | null;
  /** PDF page span (0-based inclusive); null for non-PDF docs. */
  pageStart: number | null;
  pageEnd: number | null;
}

/** Left inline panel: chapter list with AI summaries; click jumps in place. */
export function TocPanel({
  open,
  onClose,
  toc,
  current,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  toc: TocEntry[];
  current: number;
  onSelect: (chapterIndex: number) => void;
}) {
  const t = useTranslations('reader');
  if (!open) return null;
  return (
    <SidePanel side="left" title={t('toc_count', { count: toc.length })} onClose={onClose} widthClass="lg:w-[300px]">
      <ul className="py-2">
        {toc.map((c) => {
          const active = c.chapterIndex === current;
          return (
            <li key={c.chapterIndex}>
              <button
                type="button"
                onClick={() => onSelect(c.chapterIndex)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-baseline gap-2.5 px-4 py-2.5 text-left text-sm transition ${
                  active
                    ? 'bg-accent-500/10 font-medium text-[var(--reader-accent)]'
                    : 'hover:bg-[var(--reader-hover)]'
                }`}
              >
                <span className="r-muted shrink-0 font-mono text-[11px] tabular-nums">
                  {String(c.chapterIndex + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {c.title || t('chapter_n', { n: c.chapterIndex + 1 })}
                  {c.aiSummary && (
                    <span className="r-muted mt-0.5 block text-xs font-normal leading-relaxed">
                      {c.aiSummary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}
