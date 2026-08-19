import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// DELETE /api/votes/[id]/comments/[commentId] — author, activity creator or
// admin. Hard delete (flat list, nothing to orphan); counter moves in the same
// guarded array tx, races fall through to the authoritative state.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.voteComment.findUnique({
    where: { id: params.commentId },
    select: {
      id: true,
      entryId: true,
      authorId: true,
      activityId: true,
      activity: { select: { creatorId: true, deletedAt: true } },
    },
  });
  if (!comment || comment.activityId !== params.id || comment.activity.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const allowed =
    comment.authorId === session.user.id ||
    session.user.isAdmin ||
    comment.activity.creatorId === session.user.id;
  if (!allowed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    await prisma.$transaction([
      prisma.voteComment.delete({ where: { id: comment.id } }),
      prisma.voteEntry.update({
        where: { id: comment.entryId },
        data: { commentCount: { decrement: 1 } },
      }),
    ]);
  } catch (e) {
    // P2025: a racing delete already removed it — the array tx rolled the
    // counter back with the failed write; treat as done.
    const gone = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';
    if (!gone) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
