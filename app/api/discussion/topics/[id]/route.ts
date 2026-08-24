import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import {
  deleteUnreferencedMediaFiles,
  mediaArraySchema,
  mediaKeysAvailable,
  resolveMedia,
} from '@/lib/discussion-media';

export const dynamic = 'force-dynamic';

const CATEGORY_ENUM = z.enum([
  'tech',
  'models',
  'agents',
  'skills',
  'research',
  'qa',
  'share',
  'showcase',
]);

const patchSchema = z
  .object({
    title: z.string().trim().min(4, '标题至少 4 个字').max(120).optional(),
    bodyMd: z.string().max(20000).optional(),
    categories: z.array(CATEGORY_ENUM).min(1, '请至少选择一个主题').max(3, '最多选择 3 个主题').optional(),
    media: mediaArraySchema.optional(),
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
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }

  const topic = await prisma.discussionTopic.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      authorId: true,
      title: true,
      pinned: true,
      locked: true,
      media: { select: { kind: true, key: true } },
    },
  });
  if (!topic) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = topic.authorId === session.user.id;
  const { title, bodyMd, categories, media, pinned, locked } = parsed.data;

  const editsContent =
    title !== undefined || bodyMd !== undefined || categories !== undefined || media !== undefined;
  if (editsContent && !isAuthor) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const moderates = pinned !== undefined || locked !== undefined;
  if (moderates && !can(session.user, 'discussion')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Media replace: validate first, remember which uploaded files dropped out
  // so their bytes can be reclaimed after the DB write succeeds.
  let resolved: ReturnType<typeof resolveMedia> = null;
  let removedKeys: string[] = [];
  if (media !== undefined) {
    resolved = resolveMedia(media);
    if (!resolved) {
      return NextResponse.json(
        { error: 'invalid_input', reason: await apiReason('media_invalid') },
        { status: 400 },
      );
    }
    if (!(await mediaKeysAvailable(resolved, { excludeTopicId: topic.id }))) {
      return NextResponse.json(
        { error: 'invalid_input', reason: await apiReason('media_in_use') },
        { status: 400 },
      );
    }
    const keptKeys = new Set(resolved.map((m) => m.key).filter(Boolean));
    removedKeys = topic.media
      .filter((m) => (m.kind === 'video' || m.kind === 'file') && m.key && !keptKeys.has(m.key))
      .map((m) => m.key);
  }

  const uniqueCategories = categories ? [...new Set(categories)] : undefined;
  const updated = await prisma.discussionTopic.update({
    where: { id: topic.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(bodyMd !== undefined ? { bodyMd } : {}),
      ...(uniqueCategories
        ? { categories: uniqueCategories, category: uniqueCategories[0] }
        : {}),
      ...(resolved ? { media: { deleteMany: {}, create: resolved } } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(locked !== undefined ? { locked } : {}),
    },
    select: { id: true, title: true, categories: true, pinned: true, locked: true },
  });

  // Refcounted: a key still referenced by any post/topic keeps its file.
  void deleteUnreferencedMediaFiles(removedKeys);

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
    select: {
      id: true,
      title: true,
      authorId: true,
      media: { select: { kind: true, key: true } },
    },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = before.authorId === session.user.id;
  if (!isAuthor && !can(session.user, 'discussion')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.discussionTopic.delete({ where: { id: before.id } });

  // Uploaded videos/attachments can be large — reclaim the disk best-effort
  // (refcounted: a key still referenced by any post/topic keeps its file).
  void deleteUnreferencedMediaFiles(
    before.media.filter((m) => m.kind === 'video' || m.kind === 'file').map((m) => m.key),
  );

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
