import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { notifyPostReply } from '@/lib/notifications';
import { listPostComments } from '@/lib/discussion-queries';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

/** Post excerpt used in notifications — posts have no title. */
function postExcerpt(bodyMd: string): string {
  const t = bodyMd.replace(/\s+/g, ' ').trim();
  return t ? (t.length > 40 ? `${t.slice(0, 40)}…` : t) : '动态';
}

// GET /api/discussion/posts/[id]/comments?sort=relevant|recent&skip=&take=
// Paginated top-level threads (each with a short reply preview).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const sp = new URL(req.url).searchParams;
  const post = await prisma.post.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { items, totalRoots, hasMore } = await listPostComments(post.id, {
    sort: sp.get('sort') === 'recent' ? 'recent' : 'relevant',
    skip: Number(sp.get('skip') ?? 0),
    take: Number(sp.get('take') ?? 3),
    viewerId: session?.user?.id ?? null,
  });
  const canSeeIdentity = can(session?.user, 'identity');
  return NextResponse.json({
    items: items.map((c) => ({
      ...c,
      author: toPublicAuthor(c.author, canSeeIdentity),
      replies: c.replies.map((r) => ({ ...r, author: toPublicAuthor(r.author, canSeeIdentity) })),
    })),
    totalRoots,
    hasMore,
  });
}

const createSchema = z.object({
  bodyMd: z.string().trim().min(1).max(2000),
  // parentId must be a TOP-LEVEL comment (2-level flat threads, same contract
  // as video/feedback comments); replyToId marks which comment gets the
  // notification. min(1): an empty string would skip validation yet hit the FK.
  parentId: z.string().min(1).optional(),
  replyToId: z.string().min(1).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:comment:${session.user.id}`, 10, 60_000);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('rate_limited_comment') },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const post = await prisma.post.findUnique({
    where: { id: params.id },
    select: { id: true, bodyMd: true, author: { select: { id: true, email: true } } },
  });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { bodyMd, parentId, replyToId } = parsed.data;

  if (parentId) {
    const parent = await prisma.postComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true },
    });
    if (!parent || parent.postId !== post.id || parent.parentId !== null) {
      return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }
  }

  const [comment] = await prisma.$transaction([
    prisma.postComment.create({
      data: {
        postId: post.id,
        authorId: session.user.id,
        parentId: parentId ?? null,
        bodyMd,
      },
      select: {
        id: true,
        bodyMd: true,
        status: true,
        parentId: true,
        likeCount: true,
        replyCount: true,
        createdAt: true,
        author: AUTHOR_IDENTITY_SELECT,
      },
    }),
    prisma.post.update({
      where: { id: post.id },
      data: { commentCount: { increment: 1 } },
    }),
    ...(parentId
      ? [
          prisma.postComment.update({
            where: { id: parentId },
            data: { replyCount: { increment: 1 } },
          }),
        ]
      : []),
  ]);

  // Fire-and-forget: reply → notify the replied-to comment's author; top-level
  // comment → notify the post's author. Never blocks the write.
  // replyToId is only honored for actual replies and must point INSIDE the
  // thread being replied to (the root itself or one of its replies) — anything
  // else would let a crafted request direct notifications at arbitrary users.
  if (parentId) {
    const targetCommentId = replyToId ?? parentId;
    const target = await prisma.postComment.findUnique({
      where: { id: targetCommentId },
      select: {
        id: true,
        postId: true,
        parentId: true,
        status: true,
        author: { select: { id: true, email: true } },
      },
    });
    const inThread = target && (target.id === parentId || target.parentId === parentId);
    if (target && target.postId === post.id && inThread && target.status !== 'deleted') {
      void notifyPostReply({
        recipientId: target.author.id,
        recipientEmail: target.author.email,
        actorId: session.user.id,
        actorName: session.user.displayName,
        postId: post.id,
        postExcerpt: postExcerpt(post.bodyMd),
        focusId: comment.id,
        bodyMd,
        isReplyToComment: true,
      });
    }
  } else {
    void notifyPostReply({
      recipientId: post.author.id,
      recipientEmail: post.author.email,
      actorId: session.user.id,
      actorName: session.user.displayName,
      postId: post.id,
      postExcerpt: postExcerpt(post.bodyMd),
      focusId: comment.id,
      bodyMd,
      isReplyToComment: false,
    });
  }

  return NextResponse.json({
    ok: true,
    comment: {
      ...comment,
      author: toPublicAuthor(comment.author, can(session.user, 'identity')),
      likedByMe: false,
    },
  });
}
