'use client';

// 来源 line for cards, rows and the detail byline: 「公众号 · 机器之心」, 「知乎 · 张三」,
// a bare host for a plain web page, or a format badge (PDF / EPUB …) for an
// uploaded file. The kind comes from lib/library/source.ts; the label from
// labels.libSource.*. Never prints `mp.weixin.qq.com`.

import { useTranslations } from 'next-intl';
import { librarySourceKind, sourceDetail } from '@/lib/library/source';

export const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  html: 'HTML',
  pptx: 'PPT',
  docx: 'Word',
};

export function FormatBadge({ format, className = '' }: { format: string; className?: string }) {
  if (format === 'url') return null;
  return (
    <span
      className={`shrink-0 rounded border border-zinc-200 px-1.5 py-px font-mono text-[10px] font-medium uppercase text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 ${className}`}
    >
      {FORMAT_LABELS[format] ?? format}
    </span>
  );
}

export function SourceLine({
  sourceUrl,
  siteName,
  author,
  format,
  className = '',
}: {
  sourceUrl: string | null;
  siteName: string | null;
  author: string | null;
  format: string;
  className?: string;
}) {
  const tl = useTranslations('labels');
  const kind = librarySourceKind({ sourceUrl, format });
  const detail = sourceDetail({ sourceUrl, siteName, format });
  const kindLabel = kind === 'web' || kind === 'file' ? null : tl(`libSource.${kind}`);
  const byline = author?.trim() && author.trim() !== detail ? author.trim() : null;
  if (!kindLabel && !detail && !byline && kind !== 'file') return null;

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {kind === 'file' && <FormatBadge format={format} />}
      {kindLabel && (
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-px text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {kindLabel}
        </span>
      )}
      {detail && <span className="truncate">{detail}</span>}
      {byline && (
        <>
          {(detail || kindLabel) && <span aria-hidden>·</span>}
          <span className="truncate">{byline}</span>
        </>
      )}
    </span>
  );
}
