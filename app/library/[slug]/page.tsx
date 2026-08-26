import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Download, ExternalLink, Lock, Pencil, Star } from 'lucide-react';
import { format } from 'date-fns';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { relativeTime } from '@/lib/i18n-date';
import { getDocBySlug, libraryViewerFromSession } from '@/lib/library-queries';
import { can } from '@/lib/permissions';
import { CATEGORY_NAME_BY_SLUG, isDocType } from '@/lib/library/types';
import { pickOverview, pickText } from '@/lib/library/i18n-content';
import { listLibraryCategories } from '@/lib/library/categories';
import { withBasePath } from '@/lib/base-path';
import { BackButton } from '@/components/BackButton';
import { Avatar } from '@/components/Avatar';
import { DocCover } from '@/components/library/DocCover';
import { ShelfButton } from '@/components/library/ShelfButton';
import { DocLikeButton } from '@/components/library/DocLikeButton';
import { AiDigest } from '@/components/library/AiDigest';
import { ProcessingPanel, ReprocessButton } from '@/components/library/ProcessingPanel';
import { AdminDocActions } from '@/components/library/AdminDocActions';
import { DocViewPing } from '@/components/library/DocViewPing';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { RatingStars } from '@/components/library/RatingStars';
import { DocStats } from '@/components/library/DocStats';
import { UserHoverCard } from '@/components/user/UserHoverCard';
import { DocComments } from '@/components/library/DocComments';
import { AccessRequestButton } from '@/components/library/AccessRequestButton';
import { AccessRequestsPanel } from '@/components/library/AccessRequestsPanel';

export const dynamic = 'force-dynamic';

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  html: 'HTML',
  pptx: 'PPT',
  docx: 'Word',
};
const TOC_VISIBLE = 50;

/** 字数展示值：zh 用「万」，其他 locale 用「k」。单位词由 library.word_count 提供。 */
function wordCountValue(n: number, locale: string) {
  if (locale.startsWith('zh')) return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
  return n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default async function DocDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { focus?: string };
}) {
  const [t, tl, tp, td, locale] = await Promise.all([
    getTranslations('library'),
    getTranslations('labels'),
    getTranslations('profile'),
    getTranslations('dashboard'),
    getLocale(),
  ]);
  const session = await auth();
  const viewer = libraryViewerFromSession(session);
  const doc = await getDocBySlug(params.slug, viewer);
  if (!doc) notFound();

  const canManage = viewer?.canManage ?? false;
  const isUploader = viewer?.id === doc.uploaderId;
  const ready = doc.status === 'ready';
  const canRead = doc.canRead;
  const hasFile = doc.format !== 'url' && Boolean(doc.fileUrl);
  const typeLabel = tl(`docType.${isDocType(doc.docType) ? doc.docType : 'other'}`);
  const formatLabel = doc.format === 'url' ? t('format_web') : FORMAT_LABELS[doc.format] ?? doc.format;
  // Stored prose is bilingual (lib/library/i18n-content.ts) — resolve it here so
  // the client components below never see two languages at once.
  const localizedSummary = pickText(locale, doc.summary, doc.summaryEn);
  const localizedAbstract = pickText(locale, doc.abstractMd, doc.abstractMdEn);
  const localizedOverview = pickOverview(locale, doc.aiOverview, doc.aiOverviewEn);
  // Member-created categories have no message key — show their stored name.
  const categoryNames = Object.fromEntries(
    (await listLibraryCategories()).map((c) => [
      c.slug,
      locale.startsWith('zh') ? c.name : c.nameEn || c.name,
    ]),
  );

  return (
    <div className="container max-w-5xl py-8">
      {ready && !doc.deletedAt && <DocViewPing docId={doc.id} />}
      <div className="mb-5">
        <BackButton fallbackHref="/library" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="space-y-3">
          <DocCover
            title={doc.title}
            coverUrl={doc.coverUrl}
            docType={doc.docType}
            className="mx-auto aspect-[3/4] w-full max-w-[240px] rounded-2xl text-4xl lg:mx-0"
          />
          {ready && (
            <div className="mx-auto w-full max-w-[240px] space-y-2 lg:mx-0">
              {canRead ? (
                <>
                  <Link
                    href={`/library/${doc.slug}/read`}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
                  >
                    <BookOpen className="h-4 w-4" />
                    {doc.progressPercent > 0 ? t('continue_reading') : t('start_reading')}
                  </Link>
                  {doc.progressPercent > 0 && (
                    <p className="text-center text-xs text-muted">
                      {t('progress_percent', { percent: Math.round(doc.progressPercent) })}
                    </p>
                  )}
                </>
              ) : (
                <AccessRequestButton
                  docId={doc.id}
                  initialStatus={doc.myAccessStatus}
                  loggedIn={Boolean(viewer)}
                />
              )}
              <ShelfButton
                docId={doc.id}
                initialShelved={doc.shelvedByMe}
                initialCount={doc.shelfCount}
              />
              <DocLikeButton
                docId={doc.id}
                initialLiked={doc.likedByMe}
                initialCount={doc.likeCount}
              />
              {hasFile && canRead && (
                <a
                  href={withBasePath(doc.fileUrl!)}
                  download
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                >
                  <Download className="h-4 w-4" />
                  {t('download_original')}
                </a>
              )}
              {(isUploader || canManage) && (
                <Link
                  href={`/library/${doc.slug}/edit`}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700"
                >
                  <Pencil className="h-4 w-4" />
                  {t('edit_doc_link')}
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {typeLabel}
              </span>
              <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-muted dark:border-zinc-800">
                {formatLabel}
              </span>
              {doc.categories.map((cat) => (
                <Link
                  key={cat}
                  href={`/library?cat=${cat}`}
                  className="rounded-full bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-900/10 dark:hover:bg-white/[0.14]"
                >
                  {CATEGORY_NAME_BY_SLUG[cat] ? tl(`libCategory.${cat}`) : (categoryNames[cat] ?? cat)}
                </Link>
              ))}
              {doc.visibility === 'restricted' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  <Lock className="h-3 w-3" />
                  {tl('visibility.restricted')}
                </span>
              )}
              {doc.visibility === 'private' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                  <Lock className="h-3 w-3" />
                  {tl('visibility.private')}
                </span>
              )}
              {doc.featured && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
                  <Star className="h-3 w-3" />
                  {t('featured_badge')}
                </span>
              )}
              {!ready &&
                (doc.status === 'failed' ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                    {td('doc_failed')}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    {td('doc_processing')}
                  </span>
                ))}
              {doc.deletedAt && (
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                  {t('deleted_badge')}
                </span>
              )}
            </div>

            <h1 className="break-words text-3xl font-semibold tracking-tight md:text-4xl">
              {doc.title}
            </h1>

            {(doc.author || doc.siteName) && (
              <p className="text-sm text-muted">
                {[doc.author, doc.siteName].filter(Boolean).join(' · ')}
              </p>
            )}

            {doc.sourceUrl && (
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-50 transition hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                <ExternalLink className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('view_source', { host: hostOf(doc.sourceUrl) })}</span>
              </a>
            )}

            {/* Byline stays a sentence; the FIGURES move into their own block
                so the eye lands on numbers in fixed positions. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
              <UserHoverCard handle={doc.uploader.handle}>
                <span className="flex items-center gap-1.5">
                  <Avatar
                    name={doc.uploader.displayName}
                    src={doc.uploader.avatarUrl}
                    size="xs"
                  />
                  {doc.uploader.displayName}
                </span>
              </UserHoverCard>
              <span>·</span>
              <span>{t('added_at', { time: relativeTime(doc.createdAt, locale) })}</span>
              {doc.publishedAt && (
                <>
                  <span>·</span>
                  <span>{t('published_at', { date: format(doc.publishedAt, 'yyyy-MM-dd') })}</span>
                </>
              )}
            </div>

            {ready && (
              <DocStats
                docId={doc.id}
                loggedIn={Boolean(viewer)}
                wordCountLabel={
                  doc.wordCount > 0
                    ? t('word_count', { value: wordCountValue(doc.wordCount, locale) })
                    : null
                }
                readMinutes={doc.estReadMinutes}
                viewCount={doc.viewCount}
                shelfCount={doc.shelfCount}
                commentCount={doc.commentCount}
                sharedNoteCount={doc.sharedNoteCount}
              />
            )}

            {ready && (
              <RatingStars
                docId={doc.id}
                initialAvg={doc.avgRating}
                initialCount={doc.ratingCount}
                initialMine={doc.myRating}
                canRate={Boolean(viewer)}
              />
            )}

            {canManage && (
              <AdminDocActions docId={doc.id} featured={doc.featured} deleted={Boolean(doc.deletedAt)} />
            )}
          </div>

          {doc.visibility === 'restricted' && (isUploader || canManage) && (
            <AccessRequestsPanel docId={doc.id} />
          )}

          {doc.status === 'pending' || doc.status === 'processing' ? (
            <ProcessingPanel docId={doc.id} status={doc.status} />
          ) : doc.status === 'failed' ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5">
              <p className="text-sm font-medium text-danger">{t('processing_failed_title')}</p>
              <p className="mt-1 break-words text-xs text-muted">
                {doc.processingError ?? t('unknown_error')}
              </p>
              {(isUploader || canManage) && (
                <div className="mt-3">
                  <ReprocessButton docId={doc.id} />
                </div>
              )}
            </div>
          ) : (
            <>
              {localizedSummary && <p className="text-lg text-muted">{localizedSummary}</p>}

              {localizedAbstract && (
                <section className="surface rounded-2xl p-5">
                  <h2 className="text-sm font-semibold tracking-tight text-muted">{t('abstract_title')}</h2>
                  <div className="mt-2">
                    <MarkdownRenderer content={localizedAbstract} />
                  </div>
                </section>
              )}

              <AiDigest
                overview={localizedOverview}
                aiIndexState={doc.aiIndexState}
                aiError={doc.aiError}
                docId={doc.id}
                canTrigger={Boolean(session?.user)}
                slug={doc.slug}
              />

              {doc.chapters.length > 1 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {t('toc_title')}{' '}
                    <span className="text-sm font-normal text-muted">
                      {t('chapter_count', { count: doc.chapterCount })}
                    </span>
                  </h2>
                  <div className="surface overflow-hidden rounded-2xl">
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {doc.chapters.slice(0, TOC_VISIBLE).map((ch) => (
                        <TocRow key={ch.chapterIndex} slug={doc.slug} chapter={ch} />
                      ))}
                    </ul>
                    {doc.chapters.length > TOC_VISIBLE && (
                      <details>
                        <summary className="cursor-pointer border-t border-zinc-100 px-4 py-2.5 text-center text-xs text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-900/60">
                          {t('expand_all_chapters', { count: doc.chapters.length })}
                        </summary>
                        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800/60 dark:border-zinc-800/60">
                          {doc.chapters.slice(TOC_VISIBLE).map((ch) => (
                            <TocRow key={ch.chapterIndex} slug={doc.slug} chapter={ch} />
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </section>
              )}

              {hasFile && (
                <p className="text-xs text-muted">
                  {t('original_file', { format: formatLabel, size: formatBytes(doc.fileSizeBytes) })}
                </p>
              )}

              <DocComments
                docId={doc.id}
                commentCount={doc.commentCount}
                currentUser={
                  session?.user
                    ? {
                        id: session.user.id,
                        handle: session.user.handle,
                        canModerate: can(session.user, 'library'),
                      }
                    : null
                }
                focusId={typeof searchParams.focus === 'string' ? searchParams.focus : null}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function TocRow({
  slug,
  chapter,
}: {
  slug: string;
  chapter: {
    chapterIndex: number;
    title: string | null;
    charCount: number;
    aiSummary: string | null;
    aiSummaryEn: string | null;
  };
}) {
  const t = await getTranslations('library');
  const locale = await getLocale();
  const chapterSummary = pickText(locale, chapter.aiSummary, chapter.aiSummaryEn);
  return (
    <li>
      <Link
        href={`/library/${slug}/read?ch=${chapter.chapterIndex}`}
        className="flex items-baseline gap-3 px-4 py-2.5 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
      >
        <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-muted">
          {chapter.chapterIndex + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {chapter.title ?? t('chapter_n', { num: chapter.chapterIndex + 1 })}
          </span>
          {chapterSummary && (
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">{chapterSummary}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {t('word_count', { value: wordCountValue(chapter.charCount, locale) })}
        </span>
      </Link>
    </li>
  );
}
