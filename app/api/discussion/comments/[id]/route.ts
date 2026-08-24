import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Author or admin removes a post comment. Same hybrid strategy as video and
 * feedback comments: a comment that already has replies becomes a tombstone
 * (thread shape kept, body wiped); a leaf comment is hard-deleted. Counters
 * stay in sync via guarded writes inside an interactive transaction.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.postComment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      postId: true,
      authorId: true,
      parentId: true,
      replyCount: true,
      status: true,
    },
  });
  if (!comment || comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAuthor = comment.authorId === session.user.id;
  if (!isAuthor && !can(session.user, 'discussion')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Interactive transaction with guarded writes: the pre-read above is only the
  // 401/403/404 fast path. Re-deciding inside the transaction (and bailing when
  // a guarded write matched no row) keeps commentCount honest when two deletes
  // race, or when a new reply lands between the read and the delete.
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.postComment.findUnique({
      where: { id: comment.id },
      select: { replyCount: true, parentId: true, status: true },
    });
    if (!fresh || fresh.status === 'deleted') return null;

    const tombstone = fresh.replyCount > 0;
    if (tombstone) {
      const r = await tx.postComment.updateMany({
        where: { id: comment.id, status: 'visible' },
        data: { status: 'deleted', bodyMd: '' },
      });
      if (r.count === 0) return null; // lost a concurrent-delete race
    } else {
      // replyCount guard: if a reply raced in, don't cascade it away.
      const r = await tx.postComment.deleteMany({
        where: { id: comment.id, replyCount: 0 },
      });
      if (r.count === 0) return null;
    }

    await tx.post.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 } },
    });

    let prunedParent = false;
    if (fresh.parentId) {
      const parent = await tx.postComment.update({
        where: { id: fresh.parentId },
        data: { replyCount: { decrement: 1 } },
        select: { id: true, status: true, replyCount: true },
      });
      // A tombstone that just lost its last reply has nothing left to show.
      // (Its commentCount share was already decremented when it was tombstoned.)
      if (parent.status === 'deleted' && parent.replyCount <= 0) {
        const pr = await tx.postComment.deleteMany({
          where: { id: parent.id, status: 'deleted', replyCount: { lte: 0 } },
        });
        prunedParent = pr.count > 0;
      }
    }
    return { tombstone, prunedParent };
  });

  if (!outcome) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_post_comment',
      targetType: 'post_comment',
      targetId: comment.id,
      details: { postId: comment.postId },
    });
  }

  return NextResponse.json({
    ok: true,
    tombstoned: outcome.tombstone,
    prunedParent: outcome.prunedParent,
  });
}
