import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/notifications — recent items + unread count for the bell.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const recipientId = session.user.id;

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { actor: { select: { displayName: true, avatarUrl: true } } },
    }),
    prisma.notification.count({ where: { recipientId, readAt: null } }),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
      actor: n.actor ? { displayName: n.actor.displayName, avatarUrl: n.actor.avatarUrl } : null,
    })),
  });
}
