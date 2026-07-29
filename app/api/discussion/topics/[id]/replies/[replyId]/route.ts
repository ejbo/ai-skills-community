import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Author or admin removes a forum reply. Same hybrid strategy as the feedback
 * board: a reply that already has sub-replies becomes a tombstone (thread
 * shape kept, body wiped); a leaf reply is hard-deleted. Counters stay in
 * sync via guarded writes inside an interactive transaction.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; replyId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const reply = await prisma.discussionReply.findUnique({
    where: { id: params.replyId },
    select: {
      id: true,
      topicId: true,
      authorId: true,
      parentId: true,
      replyCount: true,
      status: true,
    },
  });
  if (!reply || reply.topicId !== params.id || reply.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAuthor = reply.authorId === session.user.id;
  if (!isAuthor && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Interactive transaction with guarded writes — same contract as the
  // feedback comment DELETE route (see that route for the full rationale).
  const outcome = await prisma.$transaction(async (tx) => {
    const fresh = await tx.discussionReply.findUnique({
      where: { id: reply.id },
      select: { replyCount: true, parentId: true, status: true },
    });
    if (!fresh || fresh.status === 'deleted') return null;

    const tombstone = fresh.replyCount > 0;
    if (tombstone) {
      const r = await tx.discussionReply.updateMany({
        where: { id: reply.id, status: 'visible' },
        data: { status: 'deleted', bodyMd: '' },
      });
      if (r.count === 0) return null; // lost a concurrent-delete race
    } else {
      // replyCount guard: if a sub-reply raced in, don't cascade it away.
      const r = await tx.discussionReply.deleteMany({
        where: { id: reply.id, replyCount: 0 },
      });
      if (r.count === 0) return null;
    }

    // Recompute lastActivityAt from the remaining replies so a reply-then-
    // self-delete can't permanently "necro-bump" the topic in the 最新回复
    // ordering (tombstoned rows keep their createdAt and still count).
    const [latest, topicRow] = await Promise.all([
      tx.discussionReply.findFirst({
        where: { topicId: params.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      tx.discussionTopic.findUnique({
        where: { id: params.id },
        select: { createdAt: true },
      }),
    ]);
    await tx.discussionTopic.update({
      where: { id: params.id },
      data: {
        replyCount: { decrement: 1 },
        lastActivityAt: latest?.createdAt ?? topicRow?.createdAt ?? new Date(),
      },
    });

    let prunedParent = false;
    if (fresh.parentId) {
      const parent = await tx.discussionReply.update({
        where: { id: fresh.parentId },
        data: { replyCount: { decrement: 1 } },
        select: { id: true, status: true, replyCount: true },
      });
      // A tombstone that just lost its last sub-reply has nothing left to show.
      if (parent.status === 'deleted' && parent.replyCount <= 0) {
        const pr = await tx.discussionReply.deleteMany({
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
      action: 'delete_discussion_reply',
      targetType: 'discussion_reply',
      targetId: reply.id,
      details: { topicId: params.id },
    });
  }

  return NextResponse.json({
    ok: true,
    tombstoned: outcome.tombstone,
    prunedParent: outcome.prunedParent,
  });
}
