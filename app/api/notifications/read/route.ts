import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({ id: z.string().optional(), all: z.boolean().optional() });

// POST /api/notifications/read — mark one ({id}) or every ({all:true}) read.
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
  } else if (parsed.data.id) {
    // Scope to the recipient so you can't mark someone else's notification read.
    await prisma.notification.updateMany({
      where: { id: parsed.data.id, recipientId, readAt: null },
      data: { readAt: now },
    });
  } else {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const unreadCount = await prisma.notification.count({ where: { recipientId, readAt: null } });
  return NextResponse.json({ ok: true, unreadCount });
}
