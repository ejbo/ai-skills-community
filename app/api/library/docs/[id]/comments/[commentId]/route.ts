import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';

// DELETE /api/library/docs/[id]/comments/[commentId] (author/admin) — the
// feedback board's guarded-transaction pattern: tombstone when replies exist,
// hard delete otherwise; every write re-checked inside the transaction.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.libraryComment.findUnique({
    where: { id: params.commentId },
    select: { id: true, docId: true, authorId: true, status: true },
  });
  if (!comment || comment.docId !== params.id || comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const isAuthor = comment.authorId === session.user.id;
  if (!isAuthor && !can(session.user, 'library')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.libraryComment.findUnique({
      where: { id: comment.id },
      select: { replyCount: true, parentId: true, status: true },
    });
    if (!fresh || fresh.status === 'deleted') return null;

    if (fresh.replyCount > 0) {
      const r = await tx.libraryComment.updateMany({
        where: { id: comment.id, status: 'visible' },
        data: { status: 'deleted', bodyMd: '' },
      });
      if (r.count === 0) return null;
    } else {
      const r = await tx.libraryComment.deleteMany({
        where: { id: comment.id, replyCount: 0 },
      });
      if (r.count === 0) return null;
    }

    await tx.libraryDoc.update({
      where: { id: params.id },
      data: { commentCount: { decrement: 1 } },
    });

    if (fresh.parentId) {
      await tx.libraryComment.update({
        where: { id: fresh.parentId },
        data: { replyCount: { decrement: 1 } },
      });
      // Prune a tombstoned parent whose last reply just left.
      await tx.libraryComment.deleteMany({
        where: { id: fresh.parentId, status: 'deleted', replyCount: 0 },
      });
    }
    return true;
  });
  if (!outcome) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_library_comment',
      targetType: 'library_comment',
      targetId: comment.id,
      details: { docId: params.id },
    });
  }
  return NextResponse.json({ ok: true });
}
