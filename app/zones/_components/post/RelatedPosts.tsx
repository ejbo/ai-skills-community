'use client';

// 相关帖子 (same zone; same 栏目 or a shared tag; ≤ 4) as SpotlightCard tiles.
// The RSC page computes the list (listZonePosts by first tag + by column,
// merged). The chip is the 栏目 (official solid / member dashed) or nothing —
// there is no type pill anywhere.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FolderOpen, Heart, MessageCircle } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { SpotlightCard } from '@/components/motion';
import { zonePostHref } from '@/lib/zones/shared';
import type { ZonePostCardView } from '@/lib/zones/types';
import { RelTime } from '../RelTime';
import { PILL_COLUMN, PILL_COLUMN_MEMBER } from '../ui';

export function RelatedPosts({ posts, className = '' }: { posts: ZonePostCardView[]; className?: string }) {
  const t = useTranslations('zones');
  if (posts.length === 0) return null;

  return (
    <section className={className} aria-label={t('post_related')}>
      <h2 className="mb-4 border-b border-zinc-200 pb-3 text-lg font-semibold tracking-tight dark:border-zinc-800">{t('post_related')}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {posts.map((p) => (
          <li key={p.id}>
            <SpotlightCard className="h-full">
              <Link href={zonePostHref(p.zone.slug, p.id)} className="flex h-full flex-col gap-2 p-4 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400">
                {p.column && (
                  <span className={`${p.column.official ? PILL_COLUMN : PILL_COLUMN_MEMBER} self-start`}>
                    <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{p.column.name}</span>
                  </span>
                )}
                <span className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">{p.title}</span>
                {p.summary && <span className="line-clamp-2 text-xs leading-relaxed text-muted">{p.summary}</span>}
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={p.author.displayName} src={p.author.avatarUrl} size="xs" handle={p.author.handle} />
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{p.author.displayName}</span>
                  </span>
                  {p.publishedAt && <RelTime at={p.publishedAt} />}
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Heart className="h-3 w-3" />
                    {p.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <MessageCircle className="h-3 w-3" />
                    {p.commentCount}
                  </span>
                </span>
              </Link>
            </SpotlightCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
