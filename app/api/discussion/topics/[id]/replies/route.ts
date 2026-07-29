import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { notifyTopicReply } from '@/lib/notifications';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  bodyMd: z.string().trim().min(1).max(5000),
  // parentId must be a TOP-LEVEL reply (2-level flat threads, same contract as
  // video/feedback comments); replyToId marks which reply gets the
  // notification. min(1): an empty string would skip validation yet hit the FK.
  parentId: z.string().min(1).optional(),
  replyToId: z.string().min(1).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:reply:${session.user.id}`, 10, 60_000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '回复过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, locked: true, author: { select: { id: true, email: true } } },
  });
  if (!topic) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (topic.locked && !session.user.isAdmin) {
    return NextResponse.json(
      { error: 'locked', reason: '该帖子已被锁定，无法回复' },
      { status: 403 },
    );
  }

  const { bodyMd, parentId, replyToId } = parsed.data;

  if (parentId) {
    const parent = await prisma.discussionReply.findUnique({
      where: { id: parentId },
      select: { id: true, topicId: true, parentId: true },
    });
    if (!parent || parent.topicId !== topic.id || parent.parentId !== null) {
      return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }
  }

  const [reply] = await prisma.$transaction([
    prisma.discussionReply.create({
      data: {
        topicId: topic.id,
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
        author: AUTHOR_IDENTITY_SELECT,
      },
    }),
    prisma.discussionTopic.update({
      where: { id: topic.id },
      data: { replyCount: { increment: 1 }, lastActivityAt: new Date() },
    }),
    ...(parentId
      ? [
          prisma.discussionReply.update({
            where: { id: parentId },
            data: { replyCount: { increment: 1 } },
          }),
        ]
      : []),
  ]);

  // Fire-and-forget: reply-to-reply → notify the replied-to reply's author;
  // top-level reply → notify the topic's author. Never blocks the write.
  // replyToId must point INSIDE the thread being replied to.
  if (parentId) {
    const targetReplyId = replyToId ?? parentId;
    const target = await prisma.discussionReply.findUnique({
      where: { id: targetReplyId },
      select: {
        id: true,
        topicId: true,
        parentId: true,
        status: true,
        author: { select: { id: true, email: true } },
      },
    });
    const inThread = target && (target.id === parentId || target.parentId === parentId);
    if (target && target.topicId === topic.id && inThread && target.status !== 'deleted') {
      void notifyTopicReply({
        recipientId: target.author.id,
        recipientEmail: target.author.email,
        actorId: session.user.id,
        actorName: session.user.displayName,
        topicId: topic.id,
        topicTitle: topic.title,
        focusId: reply.id,
        bodyMd,
        isReplyToComment: true,
      });
    }
  } else {
    void notifyTopicReply({
      recipientId: topic.author.id,
      recipientEmail: topic.author.email,
      actorId: session.user.id,
      actorName: session.user.displayName,
      topicId: topic.id,
      topicTitle: topic.title,
      focusId: reply.id,
      bodyMd,
      isReplyToComment: false,
    });
  }

  return NextResponse.json({
    ok: true,
    reply: { ...reply, author: toPublicAuthor(reply.author, session.user.isAdmin) },
  });
}
