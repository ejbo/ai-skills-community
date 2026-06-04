import Link from 'next/link';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { formatCount } from '@/lib/video/types';
import { VideoRowActions } from './VideoRowActions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  published: { bg: '#dcfce7', color: '#166534' },
  draft: { bg: '#fef3c7', color: '#92400e' },
  processing: { bg: '#e0e7ff', color: '#3730a3' },
  unlisted: { bg: '#e4e4e7', color: '#3f3f46' },
  archived: { bg: '#fee2e2', color: '#991b1b' },
};

export default async function AdminVideosPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const t = await getTranslations({ namespace: 'video' });
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const q = (searchParams.q ?? '').trim();

  const where: import('@prisma/client').Prisma.VideoWhereInput = { deletedAt: null };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { intervieweeName: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [videos, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        uploader: { select: { handle: true, displayName: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.video.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">{t('manage.title')}</h2>
        <Link
          href="/manage/videos/new"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          <Plus className="h-4 w-4" />
          {t('manage.new')}
        </Link>
      </div>

      <form className="surface flex flex-wrap items-center gap-2 rounded-xl p-2" action="/manage/videos">
        <input
          name="q"
          defaultValue={q}
          placeholder={t('feed.search_placeholder')}
          className="h-9 min-w-[200px] flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        />
        <button className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
          {t('feed.search_placeholder')}
        </button>
      </form>

      <div className="surface overflow-hidden rounded-xl">
        <table className="data">
          <thead>
            <tr>
              <th>{t('manage.f_title')}</th>
              <th>{t('manage.f_category')}</th>
              <th>{t('manage.f_status')}</th>
              <th>{t('detail.views')}</th>
              <th>{t('manage.save')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {videos.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-xs text-muted">
                  {t('manage.list_empty')}
                </td>
              </tr>
            )}
            {videos.map((v) => {
              const style = STATUS_STYLE[v.status] ?? STATUS_STYLE.draft;
              return (
                <tr key={v.id}>
                  <td>
                    <Link
                      href={`/manage/videos/${v.id}/edit`}
                      className="font-medium hover:text-accent-600"
                    >
                      {v.title}
                    </Link>
                    <div className="font-mono text-[10px] text-muted">{v.slug}</div>
                  </td>
                  <td className="text-[11px] text-muted">{v.category?.name ?? '—'}</td>
                  <td>
                    <span className="badge" style={{ background: style.bg, color: style.color }}>
                      {t(`status.${v.status}`)}
                    </span>
                  </td>
                  <td className="font-mono text-[11px] tabular-nums text-muted">
                    {formatCount(v.viewCount)} · ❤{formatCount(v.likeCount)} · 💬
                    {formatCount(v.commentCount)}
                  </td>
                  <td className="font-mono text-[11px] tabular-nums text-muted">
                    {format(v.updatedAt, 'MM-dd HH:mm')}
                  </td>
                  <td>
                    <VideoRowActions id={v.id} slug={v.slug} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs text-muted">
        {page} / {totalPages} · {total.toLocaleString()}
      </div>
    </div>
  );
}
