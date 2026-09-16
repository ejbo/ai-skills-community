'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar } from '@/components/Avatar';
import { CommentLikeButton } from '@/components/CommentLikeButton';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { relativeTime } from '@/lib/i18n-date';
import type { PostCommentView } from './types';

/** How the full comment section should open: focus the composer, or open a reply box under one comment. */
export interface CommentsOpenOptions {
  compose?: boolean;
  replyTo?: string;
}

/**
 * The conversation under a FEED card before anyone asks for it: the top
 * comments (server-picked, 最相关 order) as quiet bubbles, then
 * 查看全部 N 条评论. Every way into the thread — that link, 回复, the reply
 * count, a clamped body's 更多 — calls `onOpen`, which swaps this preview for
 * the full `PostComments` section (sorting, paging, replies, the composer).
 *
 * Owner, 2026-09-15: 「评论不明显，最好能先显示出几条评论，然后用户再点击展开」.
 */
export function PostCommentPreview({
  comments,
  total,
  signedIn,
  onOpen,
}: {
  comments: PostCommentView[];
  /** The post's full comment count (roots + replies). */
  total: number;
  signedIn: boolean;
  onOpen: (opts?: CommentsOpenOptions) => void;
}) {
  const t = useTranslations('discussion_ui');

  return (
    <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      {comments.map((c) => (
        <PreviewRow key={c.id} comment={c} signedIn={signedIn} onOpen={onOpen} />
      ))}
      {total > comments.length && (
        <button
          type="button"
          onClick={() => onOpen()}
          className="ml-9 text-[13px] font-medium text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          {t('view_all_comments', { count: total })}
        </button>
      )}
    </div>
  );
}

function PreviewRow({
  comment,
  signedIn,
  onOpen,
}: {
  comment: PostCommentView;
  signedIn: boolean;
  onOpen: (opts?: CommentsOpenOptions) => void;
}) {
  const t = useTranslations('discussion_ui');
  const locale = useLocale();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);

  // Same measure as PostCard's body clamp: a late-loading image or sticker
  // grows the content after mount, so watch the inner node, not the box.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 2);
    measure();
    const inner = el.firstElementChild;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [comment.bodyMd]);

  return (
    <div className="flex items-start gap-2.5">
      <Link href={`/users/${comment.author.handle}`} className="mt-1 shrink-0">
        <Avatar
          name={comment.author.displayName}
          src={comment.author.avatarUrl}
          size="xs"
          handle={comment.author.handle}
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md bg-zinc-100/70 px-3 py-2 dark:bg-zinc-800/60">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <Link
              href={`/users/${comment.author.handle}`}
              className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {comment.author.displayName}
            </Link>
            <DeptTag department={comment.author.department} lab={comment.author.lab} />
            {/* Server-rendered now, so the string can tick over before hydration
                ("11 秒前" → "13 秒前"); text-only span, so the attribute covers it. */}
            <span className="text-muted" suppressHydrationWarning>
              {relativeTime(comment.createdAt, locale)}
            </span>
          </div>
          <div
            ref={bodyRef}
            className="relative mt-0.5 max-h-[4.75rem] overflow-hidden"
            style={
              clamped
                ? { WebkitMaskImage: 'linear-gradient(to bottom, #000 60%, transparent)', maskImage: 'linear-gradient(to bottom, #000 60%, transparent)' }
                : undefined
            }
          >
            <MarkdownRenderer content={comment.bodyMd} compact />
          </div>
          {clamped && (
            <button
              type="button"
              onClick={() => onOpen()}
              className="text-xs font-medium text-muted transition hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              {t('comment_read_more')}
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 px-1 text-xs text-muted">
          <CommentLikeButton
            endpoint={`/api/discussion/comments/${comment.id}/like`}
            initialLiked={comment.likedByMe}
            initialCount={comment.likeCount}
            signedIn={signedIn}
            size="xs"
          />
          {signedIn && (
            <button
              type="button"
              onClick={() => onOpen({ replyTo: comment.id })}
              className="transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {t('reply')}
            </button>
          )}
          {comment.replyCount > 0 && (
            <button
              type="button"
              onClick={() => onOpen()}
              className="transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {t('reply_count', { count: comment.replyCount })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
