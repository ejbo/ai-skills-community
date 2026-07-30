import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { composeEventData, eventContentSchema } from '@/lib/events/validate';
import { MAX_PINNED_EVENTS } from '@/lib/event-queries';

export const dynamic = 'force-dynamic';

// Moderation payloads carry ONLY these keys (from EventActions); content edits
// carry the full form payload and are recognized by the presence of `title`.
const moderationSchema = z.object({
  pinned: z.boolean().optional(),
  cancelled: z.boolean().optional(),
});

// PATCH /api/events/[id] — content edits (author only; speakers replaced
// wholesale) OR moderation: pinned (admin), cancelled (author or admin).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const event = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, authorId: true, title: true, pinned: true, cancelledAt: true },
  });
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = event.authorId === session.user.id;
  const isAdmin = Boolean(session.user.isAdmin);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'invalid_input', reason: '请求参数无效' },
      { status: 400 },
    );
  }

  // ── content edit ──────────────────────────────────────────────────────────
  if ('title' in body) {
    if (!isAuthor) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const parsed = eventContentSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
        { status: 400 },
      );
    }
    const composed = composeEventData(parsed.data);
    if (!composed.ok) {
      return NextResponse.json({ error: 'invalid_input', reason: composed.reason }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.eventSpeaker.deleteMany({ where: { eventId: event.id } }),
      prisma.event.update({
        where: { id: event.id },
        data: {
          ...composed.value.columns,
          speakers: { create: composed.value.speakers },
        },
      }),
    ]);
    return NextResponse.json({ ok: true, event: { id: event.id } });
  }

  // ── moderation ────────────────────────────────────────────────────────────
  const parsed = moderationSchema.safeParse(body);
  if (!parsed.success || (parsed.data.pinned === undefined && parsed.data.cancelled === undefined)) {
    return NextResponse.json(
      { error: 'invalid_input', reason: '请求参数无效' },
      { status: 400 },
    );
  }
  const { pinned, cancelled } = parsed.data;
  if (pinned !== undefined && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (cancelled !== undefined && !isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // 推荐位 cap enforced on pin (discussion-board convention) — a 4th pin would
  // otherwise "succeed" yet never surface in the capped strip.
  if (pinned === true && !event.pinned) {
    const pinnedCount = await prisma.event.count({
      where: { pinned: true, deletedAt: null, id: { not: event.id } },
    });
    if (pinnedCount >= MAX_PINNED_EVENTS) {
      return NextResponse.json(
        { error: 'invalid_input', reason: `最多置顶 ${MAX_PINNED_EVENTS} 个活动，请先取消其他置顶` },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      ...(pinned !== undefined ? { pinned } : {}),
      ...(cancelled !== undefined
        ? { cancelledAt: cancelled ? (event.cancelledAt ?? new Date()) : null }
        : {}),
    },
    select: { id: true, pinned: true, cancelledAt: true },
  });

  // Audit admin-privileged actions only (author cancelling their own event is
  // an ordinary member action).
  if (isAdmin && (pinned !== undefined || !isAuthor)) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'moderate_event',
      targetType: 'event',
      targetId: event.id,
      details: {
        title: event.title,
        ...(pinned !== undefined ? { pinned: { before: event.pinned, after: pinned } } : {}),
        ...(cancelled !== undefined
          ? { cancelled: { before: event.cancelledAt != null, after: cancelled } }
          : {}),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    event: { id: updated.id, pinned: updated.pinned, cancelled: updated.cancelledAt != null },
  });
}

// DELETE /api/events/[id] — author or admin; soft delete (deletedAt), so the
// row survives for audit while vanishing from every query (deletedAt: null).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const event = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, authorId: true, title: true },
  });
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = event.authorId === session.user.id;
  if (!isAuthor && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.event.update({ where: { id: event.id }, data: { deletedAt: new Date() } });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_event',
      targetType: 'event',
      targetId: event.id,
      details: { title: event.title },
    });
  }

  return NextResponse.json({ ok: true });
}
