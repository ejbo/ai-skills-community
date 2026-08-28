import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { VOTE_COMMENT_MAX } from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const COMMENTS_TAKE = 100;

async function findContext(activityId: string, entryId: string) {
  const activity = await prisma.voteActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      creatorId: true,
      allowComments: true,
    },
  });
  if (!activity || activity.deletedAt) return null;
  const entry = await prisma.voteEntry.findUnique({
    where: { id: entryId },
    select: { id: true, activityId: true, hidden: true, status: true },
  });
  if (!entry || entry.activityId !== activity.id) return null;
  return { activity, entry };
}

// GET /api/votes/[id]/entries/[entryId]/comments (login) — flat list, oldest
// first, latest 100 (lightbox side-panel scale by design).
export async function GET(
  _req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const gate = rateLimit(`votes:comments:${session.user.id}`, 240, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const ctx = await findContext(params.id, params.entryId);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const isManager = can(session.user, 'votes') || ctx.activity.creatorId === session.user.id;
  // 隐藏/未过审作品的评论仅管理侧可见（画廊本来就看不到这些作品）。
  if ((ctx.entry.hidden || ctx.entry.status !== 'approved') && !isManager) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Newest 100, rendered oldest-first (desc scan + reverse — an asc take
  // would pin the OLDEST 100 forever once an entry passes the cap).
  const rows = (
    await prisma.voteComment.findMany({
      where: { entryId: ctx.entry.id },
      orderBy: { createdAt: 'desc' },
      take: COMMENTS_TAKE,
      include: { author: AUTHOR_IDENTITY_SELECT },
    })
  ).reverse();
  // One batched read for the viewer's likes over this page of comments.
  const likedIds = rows.length
    ? new Set(
        (
          await prisma.voteCommentLike.findMany({
            where: { userId: session.user.id, commentId: { in: rows.map((c) => c.id) } },
            select: { commentId: true },
          })
        ).map((r) => r.commentId),
      )
    : new Set<string>();
  const canSeeIdentity = can(session.user, 'identity');
  return NextResponse.json({
    ok: true,
    comments: rows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      author: toPublicAuthor(c.author, canSeeIdentity),
      isMine: c.authorId === session.user.id,
      canDelete: c.authorId === session.user.id || isManager,
      likeCount: c.likeCount,
      likedByMe: likedIds.has(c.id),
    })),
  });
}

const createSchema = z.object({
  body: z.string().trim().min(1).max(VOTE_COMMENT_MAX),
});

// POST — add a comment (plain text). Gated by the creator's allowComments
// toggle; commenting stays open after the vote ends (results discussion).
export async function POST(
  req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const gate = rateLimit(`votes:comment:${session.user.id}`, 10, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const ctx = await findContext(params.id, params.entryId);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.activity.allowComments) {
    return NextResponse.json({ error: 'comments_disabled' }, { status: 400 });
  }
  if (ctx.activity.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (ctx.entry.hidden || ctx.entry.status !== 'approved') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Guarded array tx (like-route pattern): the comment row and the counter
  // move together or not at all.
  const [created] = await prisma.$transaction([
    prisma.voteComment.create({
      data: {
        activityId: ctx.activity.id,
        entryId: ctx.entry.id,
        authorId: session.user.id,
        body: parsed.data.body,
      },
      include: { author: AUTHOR_IDENTITY_SELECT },
    }),
    prisma.voteEntry.update({
      where: { id: ctx.entry.id },
      data: { commentCount: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    comment: {
      id: created.id,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
      author: toPublicAuthor(created.author, can(session.user, 'identity')),
      isMine: true,
      canDelete: true,
      // A comment you just wrote cannot already be liked by you.
      likeCount: 0,
      likedByMe: false,
    },
  });
}
