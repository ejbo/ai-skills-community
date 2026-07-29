import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { deletePostMediaFile } from '@/lib/uploads/post-media-storage';
import { MAX_PINNED_POSTS } from '@/lib/discussion-queries';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    bodyMd: z.string().trim().min(1).max(8000).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.bodyMd !== undefined || v.pinned !== undefined, {
    message: '没有可更新的字段',
  });

/** Author: edit the body (media stays fixed). Admin: pin/unpin to the feed top. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const post = await prisma.post.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, pinned: true },
  });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = post.authorId === session.user.id;
  const { bodyMd, pinned } = parsed.data;

  if (bodyMd !== undefined && !isAuthor) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (pinned !== undefined && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // The feed's first page only surfaces MAX_PINNED_POSTS pinned posts — a 6th
  // pinned post would silently vanish from the feed, so enforce the invariant.
  if (pinned === true && !post.pinned) {
    const pinnedCount = await prisma.post.count({ where: { pinned: true } });
    if (pinnedCount >= MAX_PINNED_POSTS) {
      return NextResponse.json(
        { error: 'too_many_pinned', reason: `置顶数量已达上限（${MAX_PINNED_POSTS} 条），请先取消其他置顶` },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      ...(bodyMd !== undefined ? { bodyMd, editedAt: new Date() } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
    },
    select: { id: true, bodyMd: true, pinned: true, editedAt: true },
  });

  if (pinned !== undefined) {
    await logAdmin({
      adminUserId: session.user.id,
      action: pinned ? 'pin_post' : 'unpin_post',
      targetType: 'post',
      targetId: post.id,
      details: { before: post.pinned, after: pinned },
    });
  }

  return NextResponse.json({ ok: true, post: updated });
}

/** Author or admin: remove the post (media/comments/likes cascade). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const before = await prisma.post.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      authorId: true,
      bodyMd: true,
      media: { select: { kind: true, key: true } },
    },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = before.authorId === session.user.id;
  if (!isAuthor && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.post.delete({ where: { id: before.id } });

  // Uploaded videos/attachments can be large — reclaim the disk best-effort.
  // (Editor images are shared infrastructure and are never GC'd, same as
  // images embedded in skill/feedback markdown.)
  for (const m of before.media) {
    if ((m.kind === 'video' || m.kind === 'file') && m.key) {
      void deletePostMediaFile(m.key);
    }
  }

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_post',
      targetType: 'post',
      targetId: before.id,
      details: { excerpt: before.bodyMd.slice(0, 80) },
    });
  }

  return NextResponse.json({ ok: true });
}
