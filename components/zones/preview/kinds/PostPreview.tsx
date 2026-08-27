'use client';

// Another zone post inside the drawer: the card summary immediately, then the
// full body fetched from GET /api/zones/<slug>/posts/<id> (same gate as the
// page) rendered through ZoneMarkdown so nested embeds stay live.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { relativeTime } from '@/lib/i18n-date';
import { zoneHref } from '@/lib/zones/shared';
import type { EmbedPostData, ZonePostDetailView } from '@/lib/zones/types';
import { ZoneMarkdown } from '@/components/zones/ZoneMarkdown';
import { fmtCount } from '@/components/zones/embeds/EmbedCard';

export function PostPreview({ data }: { data: EmbedPostData }) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const locale = useLocale();
  const [body, setBody] = useState<{ status: 'loading' } | { status: 'ready'; post: ZonePostDetailView } | { status: 'failed' }>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setBody({ status: 'loading' });
    fetch(`/api/zones/${encodeURIComponent(data.zoneSlug)}/posts/${encodeURIComponent(data.id)}`)
      .then(async (res) => {
        if (cancelled) return;
        const json = (await res.json().catch(() => null)) as { post?: ZonePostDetailView } | null;
        if (!res.ok || !json?.post) {
          setBody({ status: 'failed' });
          return;
        }
        setBody({ status: 'ready', post: json.post });
      })
      .catch(() => {
        if (!cancelled) setBody({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [data.zoneSlug, data.id]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-zinc-300 px-2 py-px font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            {tl(`zonePostType.${data.type}`)}
          </span>
          <Link href={zoneHref(data.zoneSlug)} className="text-muted hover:underline">
            {data.zoneName}
          </Link>
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">{data.title}</h2>
        {data.summary && <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{data.summary}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <Link href={`/users/${data.author.handle}`} className="inline-flex items-center gap-1.5 hover:underline">
          <Avatar name={data.author.displayName} src={data.author.avatarUrl} size="xs" handle={data.author.handle} />
          <span className="text-zinc-800 dark:text-zinc-200">{data.author.displayName}</span>
        </Link>
        <DeptTag department={data.author.department} lab={data.author.lab} />
        {data.publishedAt && <span>{relativeTime(data.publishedAt, locale)}</span>}
        <span className="font-mono tabular-nums">♡ {fmtCount(data.likeCount)}</span>
        <span className="font-mono tabular-nums">💬 {fmtCount(data.commentCount)}</span>
      </div>

      <Link
        href={data.href}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {t('preview_open_post')}
      </Link>

      <section className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {body.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted" aria-busy>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('preview_loading')}
          </div>
        )}
        {body.status === 'failed' && <p className="text-sm text-muted">{t('preview_post_body_unavailable')}</p>}
        {body.status === 'ready' &&
          (body.post.bodyMd.trim() ? (
            <ZoneMarkdown content={body.post.bodyMd} embeds={body.post.embeds} compact headingIds={false} />
          ) : (
            <p className="text-sm text-muted">{t('preview_post_body_empty')}</p>
          ))}
      </section>
    </div>
  );
}
