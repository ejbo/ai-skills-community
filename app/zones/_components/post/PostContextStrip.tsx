'use client';

// Contextual strip for the reading page (M13): once the post's <h1> has left
// the viewport, a 40 px bar with the title, the 栏目 chip and live ♥ / 🔖 / 💬
// slides in under the navbar — Medium's / 知乎's contextual header, and what
// keeps the actions reachable at any depth without a left rail the dock has
// no room for. Rules:
//   - ONE IntersectionObserver on the h1 decides `shown`; nothing scroll-bound.
//   - It rides `--nav-offset` (written by NavBarShell: 68 px while the navbar
//     is visible, 0 while hidden) with the SAME 300 ms ease-out, so it follows
//     the bar instead of leaving a hole. Only this element reads the var —
//     rails, dock and TOC use constant offsets.
//   - The sticky box is zero-height (`h-0`, content overflows) so the strip
//     takes no flow space above the header.
//   - `lb` is the SAME optimistic state as PostActionBar's (useLikeBookmark),
//     so liking here updates the bottom bar and vice versa.
//   - Not rendered below `lg` (the bottom action pill hides on scroll there).
//   - Hidden = translated up + `invisible`, so the buttons leave the tab order.

import { useEffect, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { Bookmark, FolderOpen, Heart, MessageCircle } from 'lucide-react';
import { RollingNumber } from '@/components/motion';
import { zoneHref } from '@/lib/zones/shared';
import type { ZonePostDetailView } from '@/lib/zones/types';
import { PILL_COLUMN, PILL_COLUMN_MEMBER } from '../ui';
import type { LikeBookmarkState } from './useLikeBookmark';

export function PostContextStrip({
  post,
  zoneSlug,
  titleRef,
  lb,
  commentCount,
  onCommentJump,
}: {
  post: ZonePostDetailView;
  zoneSlug: string;
  /** The post <h1> (rendered by PostHeader) — the strip appears once it has scrolled out at the top. */
  titleRef: RefObject<HTMLHeadingElement>;
  lb: LikeBookmarkState;
  commentCount: number;
  onCommentJump: () => void;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Above the top edge (not merely scrolled off the bottom on a tall header).
        setShown(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
      },
      { rootMargin: '-1px 0px 0px 0px', threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [titleRef]);

  const btn =
    'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium transition disabled:opacity-60';
  const idle =
    'border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';
  const on = 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900';

  return (
    <div className="sticky top-[var(--nav-offset,0px)] z-30 hidden h-0 transition-[top] duration-300 ease-out lg:block" aria-hidden={!shown}>
      <section
        aria-label={t('strip_aria')}
        className={`-mx-1 flex h-10 items-center gap-2 border-b border-zinc-200 bg-[rgb(var(--bg))] px-1 transition-[transform,opacity,visibility] duration-200 ease-out dark:border-zinc-800 ${
          shown ? 'visible translate-y-0 opacity-100' : 'pointer-events-none invisible -translate-y-full opacity-0'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{post.title}</span>
        {post.column && (
          <Link
            href={`${zoneHref(zoneSlug)}?column=${encodeURIComponent(post.column.slug)}`}
            aria-label={t('post_column_aria', { name: post.column.name })}
            className={`${post.column.official ? PILL_COLUMN : PILL_COLUMN_MEMBER} hidden sm:inline-flex`}
            tabIndex={shown ? undefined : -1}
          >
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{post.column.name}</span>
          </Link>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <motion.button
            type="button"
            whileTap={reduce ? undefined : { scale: 0.92 }}
            onClick={() => lb.toggle('like')}
            disabled={lb.busy === 'like'}
            aria-pressed={lb.liked}
            aria-label={t('post_like')}
            tabIndex={shown ? undefined : -1}
            className={`${btn} ${lb.liked ? on : idle}`}
          >
            <Heart className={`h-3.5 w-3.5 ${lb.liked ? 'fill-current' : ''}`} />
            <span className="font-mono tabular-nums">
              <RollingNumber value={lb.likeCount} />
            </span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={reduce ? undefined : { scale: 0.92 }}
            onClick={() => lb.toggle('bookmark')}
            disabled={lb.busy === 'bookmark'}
            aria-pressed={lb.bookmarked}
            aria-label={t('post_bookmark')}
            tabIndex={shown ? undefined : -1}
            className={`${btn} ${lb.bookmarked ? on : idle}`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${lb.bookmarked ? 'fill-current' : ''}`} />
            <span className="font-mono tabular-nums">
              <RollingNumber value={lb.bookmarkCount} />
            </span>
          </motion.button>
          <button
            type="button"
            onClick={onCommentJump}
            aria-label={t('post_comments')}
            tabIndex={shown ? undefined : -1}
            className={`${btn} ${idle}`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="font-mono tabular-nums">{commentCount}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
