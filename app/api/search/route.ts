import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Lightweight site-wide search powering the ⌘K command palette. Returns a small
// number of matches per content type. Only surfaces publicly-listable rows
// (published, non-private, non-deleted; active users) so nothing private leaks.
const PER_TYPE = 6;

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 1) {
    return NextResponse.json({ q, skills: [], users: [], categories: [], tags: [], videos: [] });
  }
  const contains = { contains: q, mode: 'insensitive' as const };

  const [skills, users, categories, tags, videos] = await Promise.all([
    prisma.skill.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        visibility: { not: 'private' },
        OR: [{ name: contains }, { summary: contains }, { slug: contains }],
      },
      select: { slug: true, name: true, updatedAt: true, author: { select: { displayName: true } } },
      orderBy: [{ trendingScore: 'desc' }, { downloadCount: 'desc' }],
      take: PER_TYPE,
    }),
    prisma.user.findMany({
      where: { isActive: true, OR: [{ displayName: contains }, { handle: contains }] },
      select: { handle: true, displayName: true },
      take: PER_TYPE,
    }),
    prisma.category.findMany({
      where: { OR: [{ name: contains }, { slug: contains }] },
      select: { slug: true, name: true },
      take: PER_TYPE,
    }),
    prisma.tag.findMany({
      where: { OR: [{ name: contains }, { slug: contains }] },
      select: { slug: true, name: true, usageCount: true },
      orderBy: { usageCount: 'desc' },
      take: PER_TYPE,
    }),
    prisma.video.findMany({
      where: {
        status: 'published',
        visibility: { not: 'private' },
        deletedAt: null,
        OR: [{ title: contains }, { slug: contains }],
      },
      select: {
        slug: true,
        title: true,
        publishedAt: true,
        createdAt: true,
        uploader: { select: { displayName: true } },
      },
      orderBy: { viewCount: 'desc' },
      take: PER_TYPE,
    }),
  ]);

  // Flatten to what the palette shows: author + date for quick locating.
  return NextResponse.json({
    q,
    skills: skills.map((s) => ({ slug: s.slug, name: s.name, author: s.author.displayName, date: s.updatedAt })),
    users,
    categories,
    tags,
    videos: videos.map((v) => ({
      slug: v.slug,
      title: v.title,
      author: v.uploader.displayName,
      date: v.publishedAt ?? v.createdAt,
    })),
  });
}
