import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Download, ExternalLink, Star } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { auth } from '@/lib/auth';
import { getDocBySlug } from '@/lib/library-queries';
import { DOC_TYPE_LABELS, isDocType } from '@/lib/library/types';
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

export const dynamic = 'force-dynamic';

const FORMAT_LABELS: Record<string, string> = { url: '网页', pdf: 'PDF', epub: 'EPUB' };
const TOC_VISIBLE = 50;

function formatWords(n: number) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万字` : `${n}字`;
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

export default async function DocDetailPage({ params }: { params: { slug: string } }) {
  const session = await auth();
  const viewer = session?.user
    ? { id: session.user.id, isAdmin: Boolean(session.user.isAdmin) }
    : null;
  const doc = await getDocBySlug(params.slug, viewer);
  if (!doc) notFound();

  const isAdmin = viewer?.isAdmin ?? false;
  const isUploader = viewer?.id === doc.uploaderId;
  const ready = doc.status === 'ready';
  const hasFile = (doc.format === 'pdf' || doc.format === 'epub') && Boolean(doc.fileUrl);
  const typeLabel = DOC_TYPE_LABELS[isDocType(doc.docType) ? doc.docType : 'other'];

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
              <Link
                href={`/library/${doc.slug}/read`}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
              >
                <BookOpen className="h-4 w-4" />
                {doc.progressPercent > 0 ? '继续阅读' : '开始阅读'}
              </Link>
              {doc.progressPercent > 0 && (
                <p className="text-center text-xs text-muted">
                  进度 {Math.round(doc.progressPercent)}%
                </p>
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
              {hasFile && (
                <a
                  href={withBasePath(doc.fileUrl!)}
                  download
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 text-sm font-medium transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
                >
                  <Download className="h-4 w-4" />
                  下载原文件
                </a>
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
                {FORMAT_LABELS[doc.format] ?? doc.format}
              </span>
              {doc.featured && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
                  <Star className="h-3 w-3" />
                  精选
                </span>
              )}
              {!ready &&
                (doc.status === 'failed' ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                    处理失败
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    处理中
                  </span>
                ))}
              {doc.deletedAt && (
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                  已删除
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
                className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-accent-600 transition hover:text-accent-700 dark:text-accent-300 dark:hover:text-accent-200"
              >
                <ExternalLink className="h-4 w-4 shrink-0" />
                <span className="truncate">查看原文 · {hostOf(doc.sourceUrl)}</span>
              </a>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Avatar
                  name={doc.uploader.displayName}
                  src={doc.uploader.avatarUrl}
                  size="xs"
                  tone="subtle"
                />
                {doc.uploader.displayName}
              </span>
              <span>·</span>
              <span>收录于 {formatDistanceToNowStrict(doc.createdAt, { addSuffix: true })}</span>
              {doc.publishedAt && (
                <>
                  <span>·</span>
                  <span>发表于 {format(doc.publishedAt, 'yyyy-MM-dd')}</span>
                </>
              )}
              {doc.wordCount > 0 && (
                <>
                  <span>·</span>
                  <span>{formatWords(doc.wordCount)}</span>
                </>
              )}
              {doc.estReadMinutes > 0 && (
                <>
                  <span>·</span>
                  <span>{doc.estReadMinutes} 分钟</span>
                </>
              )}
              <span>·</span>
              <span className="font-mono tabular-nums">{doc.viewCount} 浏览</span>
              <span>·</span>
              <span className="font-mono tabular-nums">{doc.shelfCount} 收藏</span>
            </div>

            {isAdmin && (
              <AdminDocActions docId={doc.id} featured={doc.featured} deleted={Boolean(doc.deletedAt)} />
            )}
          </div>

          {doc.status === 'pending' || doc.status === 'processing' ? (
            <ProcessingPanel docId={doc.id} status={doc.status} />
          ) : doc.status === 'failed' ? (
            <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5">
              <p className="text-sm font-medium text-danger">内容处理失败</p>
              <p className="mt-1 break-words text-xs text-muted">
                {doc.processingError ?? '未知错误'}
              </p>
              {(isUploader || isAdmin) && (
                <div className="mt-3">
                  <ReprocessButton docId={doc.id} />
                </div>
              )}
            </div>
          ) : (
            <>
              {doc.summary && <p className="text-lg text-muted">{doc.summary}</p>}

              <AiDigest
                overview={doc.aiOverview}
                aiIndexState={doc.aiIndexState}
                aiError={doc.aiError}
                docId={doc.id}
                canTrigger={Boolean(session?.user)}
                slug={doc.slug}
              />

              {doc.chapters.length > 1 && (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold tracking-tight">
                    目录 <span className="text-sm font-normal text-muted">{doc.chapterCount} 章</span>
                  </h2>
                  <div className="surface overflow-hidden rounded-2xl">
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {doc.chapters.slice(0, TOC_VISIBLE).map((ch) => (
                        <TocRow key={ch.chapterIndex} slug={doc.slug} chapter={ch} />
                      ))}
                    </ul>
                    {doc.chapters.length > TOC_VISIBLE && (
                      <details>
                        <summary className="cursor-pointer border-t border-zinc-100 px-4 py-2.5 text-center text-xs text-accent-600 transition hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-900/60">
                          展开全部 {doc.chapters.length} 章
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
                  原文件：{FORMAT_LABELS[doc.format]} · {formatBytes(doc.fileSizeBytes)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TocRow({
  slug,
  chapter,
}: {
  slug: string;
  chapter: { chapterIndex: number; title: string | null; charCount: number };
}) {
  return (
    <li>
      <Link
        href={`/library/${slug}/read?ch=${chapter.chapterIndex}`}
        className="flex items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
      >
        <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-muted">
          {chapter.chapterIndex + 1}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {chapter.title ?? `第 ${chapter.chapterIndex + 1} 章`}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
          {formatWords(chapter.charCount)}
        </span>
      </Link>
    </li>
  );
}
