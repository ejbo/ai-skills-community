import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

const REACTIONS = ['like', 'celebrate', 'support', 'love', 'insightful', 'funny'] as const;

// GET /api/discussion/posts/[id]/reactions?reaction=&skip=&take=
// The "who reacted" panel: per-type counts for the tab bar + a paginated list
// of reactors (newest first), optionally filtered to one reaction type.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const post = await prisma.post.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const reactionParam = sp.get('reaction');
  const reaction = (REACTIONS as readonly string[]).includes(reactionParam ?? '')
    ? (reactionParam as (typeof REACTIONS)[number])
    : undefined;
  const rawSkip = Number(sp.get('skip') ?? 0);
  const skip = Number.isFinite(rawSkip) ? Math.max(0, Math.trunc(rawSkip)) : 0;
  const rawTake = Number(sp.get('take') ?? 30);
  const take = Number.isFinite(rawTake) ? Math.min(50, Math.max(1, Math.trunc(rawTake))) : 30;

  const where: Prisma.PostLikeWhereInput = { postId: post.id, ...(reaction ? { reaction } : {}) };

  const [grouped, rows, total] = await Promise.all([
    prisma.postLike.groupBy({
      by: ['reaction'],
      where: { postId: post.id },
      _count: { _all: true },
    }),
    prisma.postLike.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { reaction: true, createdAt: true, user: { select: AUTHOR_IDENTITY_FIELDS } },
    }),
    prisma.postLike.count({ where }),
  ]);

  const canSeeIdentity = can(session.user, 'identity');
  return NextResponse.json({
    total,
    counts: grouped
      .map((g) => ({ reaction: g.reaction, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    users: rows.map((r) => ({
      reaction: r.reaction,
      createdAt: r.createdAt,
      author: toPublicAuthor(r.user, canSeeIdentity),
    })),
    hasMore: skip + rows.length < total,
  });
}
