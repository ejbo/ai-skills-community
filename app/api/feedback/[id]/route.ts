import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const statusSchema = z.object({
  status: z.enum(['open', 'planned', 'in_progress', 'done', 'declined']),
});

/** Admin-only: move the feedback through its status workflow. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.feedback.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, status: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = await prisma.feedback.update({
    where: { id: params.id },
    data: { status: parsed.data.status },
    select: { id: true, status: true },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_feedback_status',
    targetType: 'feedback',
    targetId: params.id,
    details: { title: before.title, before: before.status, after: parsed.data.status },
  });

  return NextResponse.json({ ok: true, feedback: updated });
}

/** Author or admin: remove the feedback (comments/upvotes cascade). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const before = await prisma.feedback.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, authorId: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = before.authorId === session.user.id;
  if (!isAuthor && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.feedback.delete({ where: { id: params.id } });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_feedback',
      targetType: 'feedback',
      targetId: params.id,
      details: { title: before.title },
    });
  }

  return NextResponse.json({ ok: true });
}
