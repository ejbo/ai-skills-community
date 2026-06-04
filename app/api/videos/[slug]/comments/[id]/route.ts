import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const editSchema = z.object({ bodyMd: z.string().min(1).max(2000) });

// PATCH /api/videos/[slug]/comments/[id] (author) -> { ok }
export async function PATCH(req: Request, { params }: { params: { slug: string; id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const comment = await prisma.videoComment.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, status: true, video: { select: { slug: true } } },
  });
  if (!comment || comment.video.slug !== params.slug || comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (comment.authorId !== session.user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.videoComment.update({
    where: { id: comment.id },
    data: { bodyMd: parsed.data.bodyMd, editedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/videos/[slug]/comments/[id] (author or admin) -> { ok }
export async function DELETE(req: Request, { params }: { params: { slug: string; id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const comment = await prisma.videoComment.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, videoId: true, parentId: true, replyCount: true, status: true },
  });
  if (!comment || comment.status === 'deleted') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAuthor = comment.authorId === session.user.id;
  const isAdmin = session.user.isAdmin;
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Tombstone if it has replies (preserve thread shape); hard delete otherwise.
  await prisma.$transaction(async (tx) => {
    if (comment.replyCount > 0) {
      await tx.videoComment.update({
        where: { id: comment.id },
        data: { status: 'deleted', bodyMd: '' },
      });
    } else {
      await tx.videoComment.delete({ where: { id: comment.id } });
    }
    await tx.video.update({ where: { id: comment.videoId }, data: { commentCount: { decrement: 1 } } });
    if (comment.parentId) {
      await tx.videoComment.update({ where: { id: comment.parentId }, data: { replyCount: { decrement: 1 } } });
    }
  });

  if (isAdmin && !isAuthor) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    await logAdmin({
      adminUserId: session.user.id,
      action: 'video.comment.delete',
      targetType: 'video_comment',
      targetId: comment.id,
      details: { videoId: comment.videoId, authorId: comment.authorId },
      ip,
    });
  }

  return NextResponse.json({ ok: true });
}
