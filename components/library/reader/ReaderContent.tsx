'use client';

import { forwardRef, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { applyBasePathToHtml } from './anchoring';

interface Props {
  html: string;
  docTitle: string;
  author: string | null;
  siteName: string | null;
  chapterIndex: number;
  chapterTitle: string | null;
  chapterCount: number;
  readHref: (chapterIndex: number) => string;
  onArticleClick: (e: React.MouseEvent) => void;
}

/** Centered reading column: sanitized chapter HTML + prev/next navigation. */
export const ReaderContent = forwardRef<HTMLElement, Props>(function ReaderContent(
  { html, docTitle, author, siteName, chapterIndex, chapterTitle, chapterCount, readHref, onArticleClick },
  articleRef,
) {
  const processed = useMemo(() => applyBasePathToHtml(html), [html]);
  const byline = [author, siteName].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto w-full max-w-[var(--reader-width,680px)] px-5 pb-16 pt-20">
      <header className="mb-10 space-y-3">
        {chapterIndex === 0 ? (
          <>
            <h1 className="text-3xl font-semibold leading-snug tracking-tight">{docTitle}</h1>
            {byline && <p className="r-muted text-sm">{byline}</p>}
            {chapterCount > 1 && chapterTitle && (
              <p className="r-muted border-l-2 border-accent-500/50 pl-3 text-sm">{chapterTitle}</p>
            )}
          </>
        ) : (
          <>
            <p className="r-muted text-xs font-medium tracking-wide">
              第 {chapterIndex + 1} / {chapterCount} 章
            </p>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight">
              {chapterTitle || `第 ${chapterIndex + 1} 章`}
            </h1>
          </>
        )}
      </header>

      <article
        ref={articleRef}
        className="reader-prose"
        onClick={onArticleClick}
        dangerouslySetInnerHTML={{ __html: processed }}
      />

      {chapterCount > 1 && (
        <nav className="rborder mt-14 flex items-center justify-between gap-3 border-t pt-6">
          {chapterIndex > 0 ? (
            <Link
              href={readHref(chapterIndex - 1)}
              scroll={false}
              className="rborder inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition hover:bg-[var(--reader-hover)]"
            >
              <ChevronLeft className="h-4 w-4" />
              上一章
            </Link>
          ) : (
            <span />
          )}
          <span className="r-muted font-mono text-xs tabular-nums">
            {chapterIndex + 1} / {chapterCount}
          </span>
          {chapterIndex < chapterCount - 1 ? (
            <Link
              href={readHref(chapterIndex + 1)}
              scroll={false}
              className="rborder inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition hover:bg-[var(--reader-hover)]"
            >
              下一章
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
});
