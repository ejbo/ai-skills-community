import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { parseCommentSort } from '@/lib/video/types';
import { listReplies, listTopComments, type VideoCommentView } from '@/lib/video/queries';

// GET /api/videos/[slug]/comments?sort=&cursor=&parentId= (login)
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: { id: true, deletedAt: true } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = new URL(req.url);
  const parentId = url.searchParams.get('parentId');
  const actorId = session.user.id;

  if (parentId) {
    const comments = await listReplies(parentId, actorId);
    return NextResponse.json({ comments, nextCursor: null });
  }

  const sort = parseCommentSort(url.searchParams.get('sort'));
  const cursor = url.searchParams.get('cursor');
  const result = await listTopComments({ videoId: video.id, sort, cursor, actorId });
  return NextResponse.json(result);
}

const createSchema = z.object({
  bodyMd: z.string().min(1).max(2000),
  parentId: z.string().optional(),
});

const MINUTE_MS = 60 * 1000;

// POST /api/videos/[slug]/comments (login) -> { ok, comment }
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`vcomment:user:${session.user.id}`, 10, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { bodyMd, parentId } = parsed.data;

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: { id: true, deletedAt: true } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Replies must target a top-level comment on the same video.
  if (parentId) {
    const parent = await prisma.videoComment.findUnique({
      where: { id: parentId },
      select: { id: true, videoId: true, parentId: true },
    });
    if (!parent || parent.videoId !== video.id || parent.parentId !== null) {
      return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.videoComment.create({
      data: {
        videoId: video.id,
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
        pinned: true,
        editedAt: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true, avatarUrl: true } },
      },
    });
    await tx.video.update({ where: { id: video.id }, data: { commentCount: { increment: 1 } } });
    if (parentId) {
      await tx.videoComment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
    }
    return comment;
  });

  const comment: VideoCommentView = { ...created, likedByMe: false };
  return NextResponse.json({ ok: true, comment });
}
