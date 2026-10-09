'use client';

// One right-rail row (精选 / 热门 / 继续阅读): a small cover or a rank number, the
// title, one meta line, and — for 热门 — the member who 收录 it as an avatar
// (hover for the card). The row is one click target through the title link's
// overlay; the avatar sits above it (`relative z-10`), never a control inside
// an <a>. Client so the tabbed 热门 rail can render it; the server rails use it
// too, so there is one row, not two.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import type { DocCardData } from '@/lib/library-queries';
import { pickDocTitle } from '@/lib/library/translation-shared';
import { DocCover } from './DocCover';
import { SourceLine } from './SourceLine';

export function RailItem({
  doc,
  rank,
  percent,
  metric,
  showUploader = false,
}: {
  doc: DocCardData;
  /** Numbered list (热门) instead of a cover. */
  rank?: number;
  /** 继续阅读: progress bar + percent instead of the source line. */
  percent?: number;
  /** Trailing figure on the meta line (an 👁 count, 「5 收藏」 …). */
  metric?: ReactNode;
  /** 热门: the member who 收录 it, avatar only — hover for the card. */
  showUploader?: boolean;
}) {
  const locale = useLocale();
  const title = pickDocTitle(locale, doc);
  return (
    <li className="group relative -mx-2 flex gap-3 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60">
      {rank !== undefined ? (
        <span className="w-5 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted">{rank}</span>
      ) : (
        <span className="h-12 w-9 shrink-0 overflow-hidden rounded">
          <DocCover title={title} coverUrl={doc.coverUrl} docType={doc.docType} className="h-full w-full text-sm" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <Link
          href={`/library/${doc.slug}`}
          className="line-clamp-2 text-[13px] font-medium leading-snug after:absolute after:inset-0 group-hover:text-zinc-900 dark:group-hover:text-white"
        >
          {title}
        </Link>
        {percent !== undefined ? (
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <span className="block h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${Math.round(percent)}%` }} />
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{Math.round(percent)}%</span>
          </span>
        ) : (
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
            <SourceLine sourceUrl={doc.sourceUrl} siteName={doc.siteName} author={doc.author} format={doc.format} className="min-w-0" />
            {metric && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 font-mono tabular-nums">{metric}</span>
              </>
            )}
          </span>
        )}
      </span>
      {showUploader && (
        <span className="relative z-10 shrink-0 self-start pt-0.5">
          <Avatar name={doc.uploader.displayName} src={doc.uploader.avatarUrl} size="xs" handle={doc.uploader.handle} />
        </span>
      )}
    </li>
  );
}
