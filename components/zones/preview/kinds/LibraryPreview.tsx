'use client';

// 知识库 document inside the drawer: 导读 + chapter list + the chapter text
// rendered with the reader's own typography. The chapter HTML is stored
// (already sanitized) and passed through as-is; the innerHTML OBJECT is
// memoized (React 18.3 diffs dangerouslySetInnerHTML by identity and rebuilds
// every child otherwise — see CLAUDE.md, 知识库).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, ListTree, Loader2, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { withBasePath } from '@/lib/base-path';
import { applyBasePathToHtml } from '@/components/library/reader/anchoring';
import type { EmbedLibraryData, EmbedLibraryPreview } from '@/lib/zones/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; preview: EmbedLibraryPreview }
  | { status: 'no_access' }
  | { status: 'missing' }
  | { status: 'error' };

export function LibraryPreview({ data }: { data: EmbedLibraryData }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const [chapter, setChapter] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    if (!data.canRead) {
      setState({ status: 'no_access' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/zones/embed/library/${encodeURIComponent(data.slug)}?ch=${chapter}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setState({ status: 'no_access' });
          return;
        }
        if (res.status === 404) {
          setState({ status: 'missing' });
          return;
        }
        const json = (await res.json().catch(() => null)) as
          | (EmbedLibraryPreview & { preview?: EmbedLibraryPreview })
          | { preview?: EmbedLibraryPreview }
          | null;
        if (cancelled) return;
        const preview = json && 'doc' in json && json.doc ? (json as EmbedLibraryPreview) : json?.preview ?? null;
        if (!res.ok || !preview) {
          setState({ status: 'error' });
          return;
        }
        setState({ status: 'ready', preview });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [data.slug, data.canRead, chapter]);

  const preview = state.status === 'ready' ? state.preview : null;
  const html = preview?.chapter?.html ?? '';
  const inner = useMemo(() => ({ __html: applyBasePathToHtml(html) }), [html]);
  const chapterCount = preview?.toc.length ?? data.chapterCount;
  const cover = data.coverUrl ? withBasePath(data.coverUrl) : null;

  return (
    <div className="space-y-5">
      <header className="flex gap-4">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-28 w-20 shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-900" />
        ) : (
          <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xs text-muted dark:border-zinc-800">
            {tl(`docType.${data.docType}`)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{data.title}</h2>
          {data.author && <p className="mt-0.5 text-sm text-muted">{data.author}</p>}
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted">
            <span>{tl(`docType.${data.docType}`)}</span>
            <span>{data.format.toUpperCase()}</span>
            <span>{t('embed_meta_chapters', { count: data.chapterCount })}</span>
            <span>{t('embed_meta_minutes', { count: data.estReadMinutes })}</span>
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Avatar name={data.uploader.displayName} src={data.uploader.avatarUrl} size="xs" tone="neutral" />
            <span>{t('preview_uploaded_by', { name: data.uploader.displayName })}</span>
          </p>
          <Link
            href={data.href}
            className="mt-3 inline-flex h-8 items-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t('preview_open_library')}
          </Link>
        </div>
      </header>

      {data.summary && !preview?.overview && (
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>
      )}

      {state.status === 'no_access' && (
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-muted dark:border-zinc-700">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('preview_library_restricted')}</p>
        </div>
      )}
      {state.status === 'missing' && <p className="text-sm text-muted">{t('embed_fail_not_found')}</p>}
      {state.status === 'error' && <p className="text-sm text-muted">{t('embed_fail_error')}</p>}
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted" aria-busy>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('preview_loading')}
        </div>
      )}

      {preview && (
        <>
          {preview.overview && (
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t('preview_library_overview')}</h3>
              {preview.overview.summary && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{preview.overview.summary}</p>
              )}
              {preview.overview.keyPoints.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                  {preview.overview.keyPoints.slice(0, 6).map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <button
              type="button"
              onClick={() => setTocOpen((v) => !v)}
              aria-expanded={tocOpen}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <span className="inline-flex items-center gap-2">
                <ListTree className="h-4 w-4 text-muted" />
                {t('preview_library_toc')}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {chapter + 1} / {chapterCount}
              </span>
            </button>
            {tocOpen && (
              <ol className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-1 scroll-thin dark:border-zinc-800">
                {preview.toc.map((c) => (
                  <li key={c.chapterIndex}>
                    <button
                      type="button"
                      onClick={() => {
                        setChapter(c.chapterIndex);
                        setTocOpen(false);
                      }}
                      aria-current={c.chapterIndex === chapter ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                        c.chapterIndex === chapter
                          ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                          : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-muted">{c.chapterIndex + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{c.title || t('preview_library_chapter_n', { n: c.chapterIndex + 1 })}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {preview.chapter && (
            <section className="reader-root rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" data-reader-theme="auto" style={{ ['--reader-font-size' as string]: '15px' }}>
              <h3 className="mb-3 text-base font-semibold tracking-tight">
                {preview.chapter.title || t('preview_library_chapter_n', { n: preview.chapter.chapterIndex + 1 })}
              </h3>
              <article className="reader-prose" dangerouslySetInnerHTML={inner} />
            </section>
          )}

          <nav className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={chapter <= 0}
              onClick={() => setChapter((c) => Math.max(0, c - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('preview_prev_chapter')}
            </button>
            <button
              type="button"
              disabled={chapter >= chapterCount - 1}
              onClick={() => setChapter((c) => Math.min(chapterCount - 1, c + 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-xs font-medium transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              {t('preview_next_chapter')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
