'use client';

// 「谁看过这篇」（超级管理员，owner 2026-10-22）：帖子头部「阅读 N」旁的按钮 → 右侧抽屉列出看过的人
// （头像 / 姓名 / 部门 / 最近一次 / 看过几天），数据来自 GET /api/zones/[slug]/posts/[postId]/viewers。
// 只在 canSeeViewers（RSC 用 isSuperAdmin 决定）时渲染；浏览记录 2026-10-22 起才带用户 id，老记录只计数。

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { relativeTime } from '@/lib/i18n-date';
import type { ZonePostViewerRow } from '@/lib/zones/post-queries';
import { SideDrawer } from './CommentsDrawer';

export function PostViewersButton({ zoneSlug, postId }: { zoneSlug: string; postId: string }) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ viewers: ZonePostViewerRow[]; anonymousDays: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    fetch(`/api/zones/${encodeURIComponent(zoneSlug)}/posts/${encodeURIComponent(postId)}/viewers`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { viewers: ZonePostViewerRow[]; anonymousDays: number };
      })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [open, data, zoneSlug, postId]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-1.5 py-px text-[11px] font-medium text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-100">
        <Eye className="h-3 w-3" />
        {t('post_viewers_button')}
      </button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title={t('post_viewers_title')} count={data?.viewers.length ?? null} icon={<Eye className="h-4 w-4 text-muted" />} closeLabel={t('post_viewers_close')}>
        {error ? (
          <p className="text-sm text-muted">{t('post_viewers_failed')}</p>
        ) : !data ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('post_viewers_loading')}
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">{t('post_viewers_hint', { anonymous: data.anonymousDays })}</p>
            {data.viewers.length === 0 ? (
              <p className="text-sm text-muted">{t('post_viewers_empty')}</p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {data.viewers.map((v) => (
                  <li key={v.user.handle} className="flex items-center gap-3 py-2.5">
                    <Avatar name={v.user.displayName} src={v.user.avatarUrl} size="sm" handle={v.user.handle} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/users/${v.user.handle}`} className="truncate text-sm font-medium hover:underline">
                          {v.user.displayName}
                        </Link>
                        <DeptTag department={v.user.department} lab={v.user.lab} />
                      </div>
                      <div className="text-xs text-muted" suppressHydrationWarning>
                        {t('post_viewers_row', { last: relativeTime(v.lastAt, locale), days: v.days })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SideDrawer>
    </>
  );
}
