'use client';

// Post detail composition: article column (draft banner, PostHeader, body via
// ZoneMarkdown, attachments on mobile, PostActionBar, comments, related) and
// the xl: sticky right rail (PostToc, authors, attachments, stats). The
// comment count is lifted here so the action bar and the section header stay
// in step with live inserts/deletes. View recording is the RSC page's job.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Bookmark, Clock, Eye, FileEdit, Heart, MessageCircle } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { relativeTime } from '@/lib/i18n-date';
import type { ZoneAccess, ZoneCurrentUser, ZonePostCardView, ZonePostDetailView } from '@/lib/zones/types';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { PostHeader } from './PostHeader';
import { PostToc } from './PostToc';
import { PostActionBar } from './PostActionBar';
import { PostAttachmentsPanel } from './PostAttachmentsPanel';
import { PostComments } from './PostComments';
import { RelatedPosts } from './RelatedPosts';

const HEADING_SCROLL_MARGIN = '[&_h1]:scroll-mt-28 [&_h2]:scroll-mt-28 [&_h3]:scroll-mt-28 [&_h4]:scroll-mt-28';

export function PostDetail({
  post,
  zone,
  access,
  currentUser,
  focusId,
  related = [],
}: {
  post: ZonePostDetailView;
  zone: { id: string; slug: string; name: string };
  access: ZoneAccess;
  currentUser: ZoneCurrentUser | null;
  /** `?focus=<commentId>` — notification deep link. */
  focusId?: string;
  related?: ZonePostCardView[];
}) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const commentsRef = useRef<HTMLElement>(null);
  const authors = [post.author, ...post.coauthors];
  const canEdit = post.isAuthor || access.canModerate;

  const jumpToComments = () => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
      <article className="min-w-0 max-w-3xl">
        {post.status === 'draft' && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-400 px-4 py-3 text-sm dark:border-zinc-600">
            <span className="inline-flex items-center gap-2">
              <FileEdit className="h-4 w-4 text-muted" />
              {t('post_draft_banner')}
            </span>
            {canEdit && (
              <Link
                href={`/zones/${zone.slug}/posts/${post.id}/edit`}
                className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium leading-8 text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {t('post_continue_editing')}
              </Link>
            )}
          </div>
        )}

        <PostHeader post={post} zone={zone} />

        <div className={`mt-8 ${HEADING_SCROLL_MARGIN}`}>
          {post.bodyMd.trim() ? <ZoneMarkdown content={post.bodyMd} embeds={post.embeds} /> : <p className="text-sm text-muted">{t('post_body_empty')}</p>}
        </div>

        {post.attachments.length > 0 && <PostAttachmentsPanel attachments={post.attachments} className="mt-8 xl:hidden" />}

        <PostActionBar
          className="mt-8"
          post={post}
          zoneSlug={zone.slug}
          access={access}
          currentUser={currentUser}
          commentCount={commentCount}
          onCommentJump={jumpToComments}
        />

        <section ref={commentsRef} id="comments" className="mt-10 scroll-mt-24 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <MessageCircle className="h-4 w-4 text-muted" />
            {t('post_comments')}
            <span className="font-mono text-sm tabular-nums text-muted">{commentCount}</span>
          </h2>
          <PostComments
            zoneSlug={zone.slug}
            postId={post.id}
            currentUser={currentUser}
            canComment={access.canComment}
            canModerate={access.canModerate}
            isMember={access.isMember}
            locked={post.locked}
            focusId={focusId}
            onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
          />
        </section>

        <RelatedPosts posts={related.filter((p) => p.id !== post.id)} className="mt-12" />
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-24 space-y-7">
          <PostToc headings={post.headings} />

          <section aria-label={t('post_authors')}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_authors')}</h3>
            <ul className="space-y-2">
              {authors.map((a) => (
                <li key={a.handle}>
                  <Link href={`/users/${a.handle}`} className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <Avatar name={a.displayName} src={a.avatarUrl} size="md" tone="neutral" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.displayName}</span>
                      <DeptTag department={a.department} lab={a.lab} className="relative z-[1]" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <PostAttachmentsPanel attachments={post.attachments} />

          <section aria-label={t('post_stats')}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_stats')}</h3>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
                <dt className="inline-flex items-center gap-1 text-muted">
                  <Eye className="h-3 w-3" />
                  {t('post_stat_views')}
                </dt>
                <dd className="mt-0.5 font-mono text-base tabular-nums">{post.viewCount}</dd>
              </div>
              <div className="rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
                <dt className="inline-flex items-center gap-1 text-muted">
                  <Heart className="h-3 w-3" />
                  {t('post_stat_likes')}
                </dt>
                <dd className="mt-0.5 font-mono text-base tabular-nums">{post.likeCount}</dd>
              </div>
              <div className="rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
                <dt className="inline-flex items-center gap-1 text-muted">
                  <Bookmark className="h-3 w-3" />
                  {t('post_stat_bookmarks')}
                </dt>
                <dd className="mt-0.5 font-mono text-base tabular-nums">{post.bookmarkCount}</dd>
              </div>
              <div className="rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
                <dt className="inline-flex items-center gap-1 text-muted">
                  <Clock className="h-3 w-3" />
                  {t('post_stat_read')}
                </dt>
                <dd className="mt-0.5 font-mono text-base tabular-nums">{t('post_read_minutes', { count: post.readMinutes })}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-muted" suppressHydrationWarning>
              {post.publishedAt ? t('post_published_at', { time: relativeTime(post.publishedAt, locale) }) : t('post_created_at', { time: relativeTime(post.createdAt, locale) })}
              {post.editedAt && ` · ${t('post_edited_at', { time: relativeTime(post.editedAt, locale) })}`}
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
