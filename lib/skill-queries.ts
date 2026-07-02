import { Prisma, SourceType } from '@prisma/client';
import { prisma } from '@/lib/db';

export type SortKey = 'trending' | 'downloads' | 'newest' | 'top_rated';

export interface BrowseFilters {
  q?: string;
  category?: string;
  tag?: string;
  source?: SourceType | 'all';
  sort?: SortKey;
  page?: number;
  pageSize?: number;
  minRating?: number;
  maxTokens?: number;
  hasUpdate?: boolean;
}

function orderBy(sort: SortKey): Prisma.SkillOrderByWithRelationInput {
  switch (sort) {
    case 'downloads':
      return { downloadCount: 'desc' };
    case 'newest':
      return { createdAt: 'desc' };
    case 'top_rated':
      return { avgRating: 'desc' };
    case 'trending':
    default:
      return { trendingScore: 'desc' };
  }
}

export async function browseSkills(filters: BrowseFilters) {
  // Sanitize the raw query params — NaN/floats would throw inside Prisma.
  const rawPage = Number(filters.page ?? 1);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 24);
  const pageSize = Number.isFinite(rawSize) ? Math.min(48, Math.max(1, Math.trunc(rawSize))) : 24;

  const where: Prisma.SkillWhereInput = {
    status: 'published',
    deletedAt: null,
    // Private skills are never discoverable; restricted ones stay listed.
    visibility: { not: 'private' },
  };

  if (filters.source && filters.source !== 'all') {
    where.sourceType = filters.source;
  }
  if (filters.category) {
    where.category = { slug: filters.category };
  }
  if (filters.tag) {
    where.tags = { some: { tag: { slug: filters.tag } } };
  }
  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { descriptionMd: { contains: q, mode: 'insensitive' } },
      ];
    }
  }
  if (filters.minRating && filters.minRating > 0) {
    where.avgRating = { gte: filters.minRating };
  }
  if (filters.maxTokens && filters.maxTokens > 0) {
    where.tokenCostEstimate = { lte: filters.maxTokens };
  }

  const [total, items] = await Promise.all([
    prisma.skill.count({ where }),
    prisma.skill.findMany({
      where,
      orderBy: orderBy(filters.sort ?? 'trending'),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        slug: true,
        name: true,
        summary: true,
        sourceType: true,
        visibility: true,
        updatedAt: true,
        downloadCount: true,
        likeCount: true,
        reviewCount: true,
        avgRating: true,
        tokenCostEstimate: true,
        author: { select: { handle: true, displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

export async function getSkillBySlug(slug: string) {
  return prisma.skill.findUnique({
    where: { slug },
    include: {
      author: { select: { id: true, handle: true, displayName: true, avatarUrl: true, bio: true } },
      category: true,
      currentVersion: true,
      tags: { include: { tag: true } },
      forkedFrom: { select: { slug: true, name: true } },
      _count: {
        select: {
          forks: true,
          versions: true,
          reviews: true,
          accessRequests: { where: { status: 'pending' } },
        },
      },
    },
  });
}

export async function listCategories() {
  return prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function listPopularTags(limit = 18) {
  return prisma.tag.findMany({
    orderBy: { usageCount: 'desc' },
    take: limit,
  });
}
