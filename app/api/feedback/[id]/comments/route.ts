import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { notifyFeedbackReply } from '@/lib/notifications';

const createSchema = z.object({
  bodyMd: z.string().trim().min(1).max(2000),
  // parentId must be a TOP-LEVEL comment (2-level flat threads, same contract
  // as video comments); replyToId marks which comment gets the notification.
  // min(1): an empty string would skip validation yet still hit the FK.
  parentId: z.string().min(1).optional(),
  replyToId: z.string().min(1).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`feedback:comment:${session.user.id}`, 10, 60_000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '评论过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const feedback = await prisma.feedback.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, author: { select: { id: true, email: true } } },
  });
  if (!feedback) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { bodyMd, parentId, replyToId } = parsed.data;

  if (parentId) {
    const parent = await prisma.feedbackComment.findUnique({
      where: { id: parentId },
      select: { id: true, feedbackId: true, parentId: true },
    });
    if (!parent || parent.feedbackId !== feedback.id || parent.parentId !== null) {
      return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }
  }

  const [comment] = await prisma.$transaction([
    prisma.feedbackComment.create({
      data: {
        feedbackId: feedback.id,
        authorId: session.user.id,
        parentId: parentId ?? null,
        bodyMd,
      },
      select: {
        id: true,
        bodyMd: true,
        status: true,
        parentId: true,
        replyCount: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true, avatarUrl: true } },
      },
    }),
    prisma.feedback.update({
      where: { id: feedback.id },
      data: { commentCount: { increment: 1 } },
    }),
    ...(parentId
      ? [
          prisma.feedbackComment.update({
            where: { id: parentId },
            data: { replyCount: { increment: 1 } },
          }),
        ]
      : []),
  ]);

  // Fire-and-forget: reply → notify the replied-to comment's author; top-level
  // comment → notify the feedback's author. Never blocks the write.
  // replyToId is only honored for actual replies and must point INSIDE the
  // thread being replied to (the root itself or one of its replies) — anything
  // else would let a crafted request direct notifications at arbitrary users.
  if (parentId) {
    const targetCommentId = replyToId ?? parentId;
    const target = await prisma.feedbackComment.findUnique({
      where: { id: targetCommentId },
      select: {
        id: true,
        feedbackId: true,
        parentId: true,
        status: true,
        author: { select: { id: true, email: true } },
      },
    });
    const inThread = target && (target.id === parentId || target.parentId === parentId);
    if (target && target.feedbackId === feedback.id && inThread && target.status !== 'deleted') {
      void notifyFeedbackReply({
        recipientId: target.author.id,
        recipientEmail: target.author.email,
        actorId: session.user.id,
        actorName: session.user.displayName,
        feedbackId: feedback.id,
        feedbackTitle: feedback.title,
        focusId: comment.id,
        bodyMd,
        isReplyToComment: true,
      });
    }
  } else {
    void notifyFeedbackReply({
      recipientId: feedback.author.id,
      recipientEmail: feedback.author.email,
      actorId: session.user.id,
      actorName: session.user.displayName,
      feedbackId: feedback.id,
      feedbackTitle: feedback.title,
      focusId: comment.id,
      bodyMd,
      isReplyToComment: false,
    });
  }

  return NextResponse.json({ ok: true, comment });
}
