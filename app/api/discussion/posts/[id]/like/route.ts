import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PostReaction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  reaction: z.enum(['like', 'celebrate', 'support', 'love', 'insightful', 'funny']).default('like'),
});

async function reactionCounts(postId: string) {
  const grouped = await prisma.postLike.groupBy({
    by: ['reaction'],
    where: { postId },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({ reaction: g.reaction, count: g._count._all }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Set / switch / remove the viewer's reaction (LinkedIn semantics: one
 * reaction per user per post; sending the type you already have toggles it
 * off; a different type switches in place). `Post.likeCount` is the TOTAL
 * across all reaction types, so switching never touches the counter.
 * Returns the authoritative state.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // Legacy/empty bodies default to 'like' (the plain-click path).
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const reaction = parsed.data.reaction as PostReaction;

  const post = await prisma.post.findUnique({
    where: { id: params.id },
    select: { id: true, likeCount: true },
  });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const key = { userId_postId: { userId: session.user.id, postId: post.id } };
  const existing = await prisma.postLike.findUnique({ where: key });

  try {
    if (existing && existing.reaction === reaction) {
      await prisma.$transaction([
        prisma.postLike.delete({ where: key }),
        prisma.post.update({
          where: { id: post.id },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    } else if (existing) {
      await prisma.postLike.update({ where: key, data: { reaction } });
    } else {
      await prisma.$transaction([
        prisma.postLike.create({
          data: { userId: session.user.id, postId: post.id, reaction },
        }),
        prisma.post.update({
          where: { id: post.id },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
    }
  } catch {
    // Same-user race from a second tab/device (P2002 duplicate create, P2025
    // vanished delete/update): the array transaction already rolled the
    // counter back with the failed write — fall through and return whatever
    // state won, instead of 500ing.
  }

  const [row, postRow, reactions] = await Promise.all([
    prisma.postLike.findUnique({ where: key, select: { reaction: true } }),
    prisma.post.findUnique({ where: { id: post.id }, select: { likeCount: true } }),
    reactionCounts(post.id),
  ]);

  return NextResponse.json({
    myReaction: row?.reaction ?? null,
    likeCount: postRow?.likeCount ?? 0,
    reactions,
  });
}
