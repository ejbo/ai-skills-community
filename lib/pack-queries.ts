import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

// A pack only ever lists skills that are themselves discoverable — published,
// not deleted, not private. Applied to every member read so a skill that is
// archived/privatized AFTER being added to a pack silently drops out.
export const INSTALLABLE_SKILL_WHERE = {
  status: 'published',
  deletedAt: null,
  visibility: { not: 'private' },
} satisfies Prisma.SkillWhereInput;

export interface BrowsePackFilters {
  q?: string;
  page?: number;
  pageSize?: number;
}

export async function browsePacks(filters: BrowsePackFilters) {
  // Query params arrive unvalidated (?page=abc / ?page=1.5 / repeated keys):
  // sanitize so NaN/floats never reach Prisma's skip/take.
  const rawPage = Number(filters.page ?? 1);
  const requested = Number.isFinite(rawPage) ? Math.max(1, Math.trunc(rawPage)) : 1;
  const rawSize = Number(filters.pageSize ?? 24);
  const pageSize = Number.isFinite(rawSize) ? Math.min(48, Math.max(1, Math.trunc(rawSize))) : 24;

  const where: Prisma.SkillPackWhereInput = { isPublished: true };
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

  // Count first so an out-of-range ?page= clamps to the last real page instead
  // of rendering a misleading "no packs" empty state.
  const total = await prisma.skillPack.count({ where });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));

  const items = await prisma.skillPack.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      slug: true,
      name: true,
      summary: true,
      icon: true,
      installCount: true,
      updatedAt: true,
      items: {
        where: { skill: INSTALLABLE_SKILL_WHERE },
        orderBy: { sortOrder: 'asc' },
        select: { skill: { select: { slug: true, name: true } } },
      },
    },
  });

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  };
}

/** Full pack for the detail page. Members carry what SkillCard needs. */
export async function getPackBySlug(slug: string) {
  return prisma.skillPack.findUnique({
    where: { slug },
    include: {
      items: {
        where: { skill: INSTALLABLE_SKILL_WHERE },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          skill: {
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
          },
        },
      },
    },
  });
}
