import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { notifyZoneReply } from '@/lib/notifications';
import { notifyMentions, zonePostMentionGate } from '@/lib/mention-notify';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { zoneContext } from '@/lib/zones/access';
import { canSeeZonePost, listZoneComments } from '@/lib/zones/post-queries';
import { ZONE_LIMITS } from '@/lib/zones/shared';
import type { ZoneCommentView } from '@/lib/zones/types';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const COMMENTS_PER_MINUTE = 10;

const createSchema = z.object({
  bodyMd: z.string().trim().min(1).max(ZONE_LIMITS.commentMax),
  // parentId must be a TOP-LEVEL comment (2-level flat threads, same contract
  // as the discussion / feedback / video boards); replyToId marks which
  // comment gets the notification. min(1): an empty string would skip
  // validation yet hit the FK.
  parentId: z.string().min(1).optional(),
  replyToId: z.string().min(1).optional(),
});

// `visibility` + authorId/coauthors/status/deletedAt are what `canSeeZonePost`
// needs: a 仅成员可见 / 未解锁的指定成员可见 post must not expose its comments.
const POST_SELECT = {
  id: true,
  zoneId: true,
  title: true,
  status: true,
  locked: true,
  deletedAt: true,
  authorId: true,
  visibility: true,
  coauthors: { select: { userId: true } },
  author: { select: { id: true, email: true } },
} as const;

// GET /api/zones/[slug]/posts/[postId]/comments?sort=relevant|recent&skip&take
//   → { items: ZoneThreadView[], totalRoots, hasMore }
export async function GET(req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const post = await prisma.zonePost.findUnique({ where: { id: params.postId }, select: POST_SELECT });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canSeeZonePost(post, ctx.access, ctx.viewer))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const sp = new URL(req.url).searchParams;
  const sort = sp.get('sort') === 'recent' ? 'recent' : 'relevant';
  const skipRaw = Number.parseInt(sp.get('skip') ?? '', 10);
  const takeRaw = Number.parseInt(sp.get('take') ?? '', 10);
  const skip = Number.isFinite(skipRaw) ? Math.max(0, skipRaw) : 0;
  const take = Number.isFinite(takeRaw) ? Math.min(20, Math.max(1, takeRaw)) : undefined;

  const result = await listZoneComments(post.id, { sort, skip, take, viewer: ctx.viewer });
  return NextResponse.json(result);
}

// POST /api/zones/[slug]/posts/[postId]/comments { bodyMd, parentId?, replyToId? }
//   (access.canComment; locked ⇒ 403 unless canModerate) → { ok, comment: ZoneCommentView }
export async function POST(req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:comment:${session.user.id}`, COMMENTS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('zone_rate_limited_comment'), resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canComment) {
    return NextResponse.json(
      { error: 'forbidden', reason: await apiReason('zone_comment_forbidden') },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const post = await prisma.zonePost.findUnique({ where: { id: params.postId }, select: POST_SELECT });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt || post.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canSeeZonePost(post, ctx.access, ctx.viewer))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (post.locked && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'locked', reason: await apiReason('zone_post_locked') }, { status: 403 });
  }

  const { bodyMd, parentId, replyToId } = parsed.data;
  if (parentId) {
    const parent = await prisma.zonePostComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true },
    });
    if (!parent || parent.postId !== post.id || parent.parentId !== null) {
      return NextResponse.json(
        { error: 'invalid_parent', reason: await apiReason('zone_invalid_parent') },
        { status: 400 },
      );
    }
  }

  const uid = session.user.id;
  const [comment] = await prisma.$transaction([
    prisma.zonePostComment.create({
      data: { postId: post.id, authorId: uid, parentId: parentId ?? null, bodyMd },
      select: {
        id: true,
        postId: true,
        parentId: true,
        bodyMd: true,
        status: true,
        likeCount: true,
        replyCount: true,
        createdAt: true,
        editedAt: true,
        author: AUTHOR_IDENTITY_SELECT,
      },
    }),
    prisma.zonePost.update({ where: { id: post.id }, data: { commentCount: { increment: 1 } } }),
    prisma.zone.update({ where: { id: ctx.zone.id }, data: { lastActivityAt: new Date() } }),
    ...(parentId
      ? [prisma.zonePostComment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } })]
      : []),
  ]);

  // replyToId is only honored for actual replies and must point INSIDE the
  // thread being replied to (the root itself or one of its replies).
  if (parentId) {
    const targetCommentId = replyToId ?? parentId;
    const target = await prisma.zonePostComment.findUnique({
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
      void notifyZoneReply({
        recipientId: target.author.id,
        recipientEmail: target.author.email,
        actorId: uid,
        actorName: session.user.displayName,
        zoneSlug: ctx.zone.slug,
        postId: post.id,
        postTitle: post.title,
        focusId: comment.id,
        bodyMd,
        isReplyToComment: true,
      });
    }
  } else {
    void notifyZoneReply({
      recipientId: post.author.id,
      recipientEmail: post.author.email,
      actorId: uid,
      actorName: session.user.displayName,
      zoneSlug: ctx.zone.slug,
      postId: post.id,
      postTitle: post.title,
      focusId: comment.id,
      bodyMd,
      isReplyToComment: false,
    });
  }

  // @人 — gated by the post's OWN visibility (zone gate + post visibility +
  // restricted grants), so a mention inside a 仅成员可见 / 未解锁 post stays
  // silent for anyone who could not open it. Best-effort, never blocks.
  void notifyMentions({
    bodyMd,
    actorId: uid,
    actorName: session.user.displayName,
    site: {
      what: '帖子',
      title: post.title,
      link: `/zones/${ctx.zone.slug}/posts/${post.id}?focus=${comment.id}`,
    },
    gate: zonePostMentionGate({
      zone: ctx.zone,
      post: {
        id: post.id,
        authorId: post.authorId,
        coauthorIds: post.coauthors.map((c) => c.userId),
        status: post.status,
        deletedAt: post.deletedAt,
        visibility: post.visibility,
      },
    }),
  });

  const view: ZoneCommentView = {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    bodyMd: comment.bodyMd,
    status: comment.status,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    author: toPublicAuthor(comment.author, ctx.access.canSeeIdentity),
    isMine: true,
    likedByMe: false,
  };
  return NextResponse.json({ ok: true, comment: view });
}
