import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    title: z.string().trim().min(4, '标题至少 4 个字').max(120).optional(),
    bodyMd: z.string().max(20000).optional(),
    category: z.enum(['tech', 'qa', 'share', 'showcase', 'general']).optional(),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: '没有可更新的字段',
  });

/** Author: edit title/body/category. Admin: pin/unpin, lock/unlock. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, title: true, pinned: true, locked: true },
  });
  if (!topic) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = topic.authorId === session.user.id;
  const { title, bodyMd, category, pinned, locked } = parsed.data;

  const editsContent = title !== undefined || bodyMd !== undefined || category !== undefined;
  if (editsContent && !isAuthor) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const moderates = pinned !== undefined || locked !== undefined;
  if (moderates && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const updated = await prisma.discussionTopic.update({
    where: { id: topic.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(bodyMd !== undefined ? { bodyMd } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(locked !== undefined ? { locked } : {}),
    },
    select: { id: true, title: true, category: true, pinned: true, locked: true },
  });

  if (moderates) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'moderate_discussion_topic',
      targetType: 'discussion_topic',
      targetId: topic.id,
      details: {
        title: topic.title,
        ...(pinned !== undefined ? { pinned: { before: topic.pinned, after: pinned } } : {}),
        ...(locked !== undefined ? { locked: { before: topic.locked, after: locked } } : {}),
      },
    });
  }

  return NextResponse.json({ ok: true, topic: updated });
}

/** Author or admin: remove the topic (replies/upvotes cascade). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const before = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, authorId: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = before.authorId === session.user.id;
  if (!isAuthor && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.discussionTopic.delete({ where: { id: before.id } });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_discussion_topic',
      targetType: 'discussion_topic',
      targetId: before.id,
      details: { title: before.title },
    });
  }

  return NextResponse.json({ ok: true });
}
