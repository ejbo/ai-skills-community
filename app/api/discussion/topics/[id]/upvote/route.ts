import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Toggle the viewer's +1. Returns the authoritative count. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!topic) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const key = { userId_topicId: { userId: session.user.id, topicId: topic.id } };
  const existing = await prisma.discussionUpvote.findUnique({ where: key });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.discussionUpvote.delete({ where: key }),
      prisma.discussionTopic.update({
        where: { id: topic.id },
        data: { upvoteCount: { decrement: 1 } },
        select: { upvoteCount: true },
      }),
    ]);
    return NextResponse.json({ upvoted: false, upvoteCount: updated.upvoteCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.discussionUpvote.create({
      data: { userId: session.user.id, topicId: topic.id },
    }),
    prisma.discussionTopic.update({
      where: { id: topic.id },
      data: { upvoteCount: { increment: 1 } },
      select: { upvoteCount: true },
    }),
  ]);
  return NextResponse.json({ upvoted: true, upvoteCount: updated.upvoteCount });
}
