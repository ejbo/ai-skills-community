'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { applyBasePathToHtml } from './anchoring';

interface Props {
  html: string;
  /** Whole-chapter 译文; rendered instead of `html` when view is 'translated'. */
  translatedHtml?: string | null;
  view?: 'original' | 'translated';
  docTitle: string;
  author: string | null;
  siteName: string | null;
  chapterIndex: number;
  chapterTitle: string | null;
  chapterCount: number;
  /** 'paged' shows prev/next navigation; 'flow' stacks chapters continuously. */
  mode: 'paged' | 'flow';
  readHref: (chapterIndex: number) => string;
  registerRoot: (el: HTMLElement | null) => void;
}

/** One chapter's reading block: header + sanitized HTML article. */
export function ReaderContent({
  html,
  translatedHtml,
  view = 'original',
  docTitle,
  author,
  siteName,
  chapterIndex,
  chapterTitle,
  chapterCount,
  mode,
  readHref,
  registerRoot,
}: Props) {
  const t = useTranslations('reader');
  /**
   * The dangerouslySetInnerHTML OBJECT must be memoized, not just the string.
   *
   * React 18.3's `updateProperties` diffs props by IDENTITY (`nextProp !==
   * lastProp`) and, for `dangerouslySetInnerHTML`, then calls `setInnerHTMLImpl`
   * unconditionally — it never compares `__html`. A fresh `{ __html }` literal
   * per render therefore made React destroy and rebuild every child of this
   * <article> on EVERY re-render of the reader — including every scroll frame,
   * since progress tracking sets state per frame.
   *
   * That is what made text impossible to select (the nodes under the pointer
   * were replaced mid-drag) and highlights invisible (their anchored Ranges
   * pointed at detached text nodes, so the browser painted nothing). Verified
   * in Chrome: the innerHTML setter fired from React's commitUpdate right after
   * mouseup, replacing all 5 children.
   *
   * With a stable object identity React skips the prop entirely and the article
   * DOM is never touched after mount.
   */
  const source = view === 'translated' && translatedHtml ? translatedHtml : html;
  const inner = useMemo(() => ({ __html: applyBasePathToHtml(source) }), [source]);
  const byline = [author, siteName].filter(Boolean).join(' · ');

  return (
    <div
      className={`mx-auto w-full max-w-[var(--reader-width,680px)] px-5 ${
        mode === 'flow' ? 'py-6 first:pt-10' : 'py-10'
      }`}
    >
      <header className={mode === 'flow' && chapterIndex > 0 ? 'mb-6 space-y-2' : 'mb-10 space-y-3'}>
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
              {t('chapter_x_of_y', { current: chapterIndex + 1, total: chapterCount })}
            </p>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight">
              {chapterTitle || t('chapter_n', { n: chapterIndex + 1 })}
            </h1>
          </>
        )}
      </header>

      <article ref={registerRoot} className="reader-prose" dangerouslySetInnerHTML={inner} />

      {mode === 'paged' && chapterCount > 1 && (
        <nav className="rborder mt-14 flex items-center justify-between gap-3 border-t pt-6">
          {chapterIndex > 0 ? (
            <Link
              href={readHref(chapterIndex - 1)}
              replace
              scroll={false}
              className="rborder inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition hover:bg-[var(--reader-hover)]"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('prev_chapter')}
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
              replace
              scroll={false}
              className="rborder inline-flex h-9 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition hover:bg-[var(--reader-hover)]"
            >
              {t('next_chapter')}
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
