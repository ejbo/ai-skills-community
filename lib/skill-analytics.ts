import { prisma } from '@/lib/db';

/**
 * Download / usage analytics computed on-the-fly via groupBy over the (indexed)
 * Download table. Shared by the owner ManageTab and the admin skill-detail page.
 *
 * "Real" downloads = everything except Try-It runs (which are logged with
 * via='try' for usage stats but never bump the download counters). Legacy rows
 * created before this feature have via=NULL and are counted as real downloads.
 */

const NOT_TRY = { NOT: { via: 'try' as string } };

const DOWNLOADER_USER_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  email: true,
  huaweiW3Id: true,
  avatarUrl: true,
} as const;

export async function getSkillAnalytics(skillId: string) {
  const [skill, versions, byVersion, byClient, byVia, uniqueUsers] = await Promise.all([
    prisma.skill.findUnique({
      where: { id: skillId },
      select: {
        downloadCount: true,
        favoriteCount: true,
        likeCount: true,
        subscriberCount: true,
        reviewCount: true,
        avgRating: true,
      },
    }),
    prisma.skillVersion.findMany({
      where: { skillId },
      orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
      select: { id: true, version: true, status: true, publishedAt: true, totalBytes: true, downloadCount: true },
    }),
    prisma.download.groupBy({ by: ['versionId'], where: { skillId, ...NOT_TRY }, _count: { _all: true } }),
    prisma.download.groupBy({ by: ['client'], where: { skillId, ...NOT_TRY }, _count: { _all: true } }),
    prisma.download.groupBy({ by: ['via'], where: { skillId }, _count: { _all: true } }),
    prisma.download.findMany({
      where: { skillId, userId: { not: null }, ...NOT_TRY },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const perVersionMap = new Map(byVersion.map((r) => [r.versionId, r._count._all]));
  const clientSplit = { web: 0, cli: 0 };
  for (const r of byClient) clientSplit[r.client] = r._count._all;
  const viaSplit: Record<string, number> = {};
  for (const r of byVia) viaSplit[r.via ?? 'unknown'] = r._count._all;
  const totalReal = clientSplit.web + clientSplit.cli;

  return {
    totals: {
      downloads: totalReal,
      uniqueDownloaders: uniqueUsers.length,
      favorites: skill?.favoriteCount ?? 0,
      likes: skill?.likeCount ?? 0,
      subscribers: skill?.subscriberCount ?? 0,
      reviews: skill?.reviewCount ?? 0,
      avgRating: skill?.avgRating ?? 0,
      tryRuns: viaSplit['try'] ?? 0,
    },
    clientSplit,
    viaSplit,
    perVersion: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt,
      totalBytes: v.totalBytes,
      downloads: perVersionMap.get(v.id) ?? 0,
    })),
  };
}

export type SkillAnalytics = Awaited<ReturnType<typeof getSkillAnalytics>>;

export async function getSkillDownloaders(skillId: string, take = 100) {
  return prisma.download.findMany({
    where: { skillId, ...NOT_TRY },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      createdAt: true,
      via: true,
      client: true,
      ipHash: true,
      version: { select: { version: true } },
      user: { select: DOWNLOADER_USER_SELECT },
    },
  });
}

export type DownloaderRow = Awaited<ReturnType<typeof getSkillDownloaders>>[number];

/** Daily download counts for the last `days` days (gaps filled with 0). */
export async function getSkillDownloadTimeseries(skillId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.download.findMany({
    where: { skillId, ...NOT_TRY, createdAt: { gte: since } },
    select: { createdAt: true },
  });
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const series: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    series.push({ day, count: buckets.get(day) ?? 0 });
  }
  return series;
}

/** Pending requests + decided grants for a skill (owner inbox / admin view). */
export async function getSkillAccessOverview(skillId: string) {
  const [pending, approved, past] = await Promise.all([
    prisma.skillAccessRequest.findMany({
      where: { skillId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: DOWNLOADER_USER_SELECT } },
    }),
    prisma.skillAccessRequest.findMany({
      where: { skillId, status: 'approved' },
      orderBy: { decidedAt: 'desc' },
      include: {
        user: { select: DOWNLOADER_USER_SELECT },
        decidedBy: { select: { id: true, displayName: true, handle: true } },
      },
    }),
    prisma.skillAccessRequest.findMany({
      where: { skillId, status: { in: ['rejected', 'revoked'] } },
      orderBy: { decidedAt: 'desc' },
      include: {
        user: { select: DOWNLOADER_USER_SELECT },
        decidedBy: { select: { id: true, displayName: true, handle: true } },
      },
    }),
  ]);
  return { pending, approved, past };
}

export type AccessOverview = Awaited<ReturnType<typeof getSkillAccessOverview>>;

/** Count of pending access requests across all skills owned by a user. */
export async function countPendingRequestsForAuthor(authorId: string) {
  return prisma.skillAccessRequest.count({
    where: { status: 'pending', skill: { authorId } },
  });
}
