import { prisma } from '@/lib/db';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Admin-set per-user download cap (/manage/users → 每日下载上限), enforced as a
 * rolling 24h window over attributed Download rows. via='try' rows are excluded
 * — those may only be created server-side (playground), never from request
 * input. Shared by every byte-serving route (/raw and the /api/storage proxy)
 * so there is no uncapped path to skill content.
 *
 * Returns the configured limit when the user has exhausted it, else null.
 */
export async function exceededDownloadLimit(userId: string): Promise<number | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyDownloadLimit: true },
  });
  const limit = u?.dailyDownloadLimit;
  if (limit == null) return null;
  if (limit <= 0) return limit; // 0 = blocked outright; skip the count query
  const used = await prisma.download.count({
    where: { userId, createdAt: { gte: new Date(Date.now() - WINDOW_MS) }, via: { not: 'try' } },
  });
  return used >= limit ? limit : null;
}

export function downloadLimitBody(limit: number) {
  return {
    error: 'download_limit_reached',
    message:
      limit === 0
        ? '你的账号每日下载上限为 0（已被禁止下载），请联系管理员调整额度。'
        : `已达到每日下载上限（${limit} 次/24 小时）。请稍后再试，或联系管理员调整额度。`,
  };
}
