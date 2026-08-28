import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/library/docs/[id]/comments/[commentId]/like (login) — toggle.
// Gate mirrors the comments LIST route exactly (doc ready, not deleted); the
// document's own visibility is enforced where the page is served.
export async function POST(
  _req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:comment-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const comment = await prisma.libraryComment.findUnique({
    where: { id: params.commentId },
    select: {
      id: true,
      status: true,
      docId: true,
      doc: { select: { status: true, deletedAt: true } },
    },
  });
  if (
    !comment ||
    comment.status === 'deleted' ||
    comment.docId !== params.id ||
    comment.doc.deletedAt ||
    comment.doc.status !== 'ready'
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, commentId: comment.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.libraryCommentLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.libraryComment.update({
        where: { id: comment.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.libraryCommentLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.libraryComment.update({
        where: { id: comment.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.libraryComment.findUnique({ where: { id: comment.id }, select: { likeCount: true } }),
    prisma.libraryCommentLike.findUnique({
      where: { userId_commentId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({ liked: Boolean(mine), likeCount: Math.max(0, fresh?.likeCount ?? 0) });
}
