import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

/** Toggle the viewer's +1. Returns the authoritative count. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const feedback = await prisma.feedback.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!feedback) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const key = { userId_feedbackId: { userId: session.user.id, feedbackId: feedback.id } };
  const existing = await prisma.feedbackUpvote.findUnique({ where: key });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.feedbackUpvote.delete({ where: key }),
      prisma.feedback.update({
        where: { id: feedback.id },
        data: { upvoteCount: { decrement: 1 } },
        select: { upvoteCount: true },
      }),
    ]);
    return NextResponse.json({ upvoted: false, upvoteCount: updated.upvoteCount });
  }

  const [, updated] = await prisma.$transaction([
    prisma.feedbackUpvote.create({
      data: { userId: session.user.id, feedbackId: feedback.id },
    }),
    prisma.feedback.update({
      where: { id: feedback.id },
      data: { upvoteCount: { increment: 1 } },
      select: { upvoteCount: true },
    }),
  ]);
  return NextResponse.json({ upvoted: true, upvoteCount: updated.upvoteCount });
}
