import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * A dwell over the bell list marks items read (`ids`), so one flush can carry
 * several at once — the cap keeps a crafted body from turning into an unbounded
 * `IN (…)`. The bell only ever holds 20 rows, so 100 is generous.
 */
const MAX_IDS = 100;

const schema = z.object({
  id: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).min(1).max(MAX_IDS).optional(),
  all: z.boolean().optional(),
});

// POST /api/notifications/read — mark one ({id}), several ({ids}) or every
// ({all:true}) notification read. Always answers with the authoritative unread
// count so the client can reconcile its optimistic paint.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const recipientId = session.user.id;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const now = new Date();
  if (parsed.data.all) {
    await prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: now },
    });
  } else {
    const ids = [...new Set([...(parsed.data.ids ?? []), ...(parsed.data.id ? [parsed.data.id] : [])])];
    if (ids.length === 0) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    // Scope to the recipient so you can't mark someone else's notification read.
    await prisma.notification.updateMany({
      where: { id: { in: ids }, recipientId, readAt: null },
      data: { readAt: now },
    });
  }

  const unreadCount = await prisma.notification.count({ where: { recipientId, readAt: null } });
  return NextResponse.json({ ok: true, unreadCount });
}
