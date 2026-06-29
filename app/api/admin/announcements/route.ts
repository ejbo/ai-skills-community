import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { fanoutAnnouncement } from '@/lib/notifications';
import { plainSummary } from '@/lib/announcement';

export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(40000).default(''),
  publish: z.boolean().default(false),
});

// POST /api/admin/announcements — create a draft, or create+publish (fan out).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { title, bodyMd, publish } = parsed.data;
  const created = await prisma.announcement.create({
    data: { title, bodyMd, createdById: session.user.id, publishedAt: publish ? new Date() : null },
  });

  let fanout = { inApp: 0, email: 0 };
  if (publish) {
    fanout = await fanoutAnnouncement({
      announcementId: created.id,
      actorId: session.user.id,
      title: created.title,
      summary: plainSummary(created.bodyMd),
    });
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: publish ? 'publish_announcement' : 'create_announcement',
    targetType: 'announcement',
    targetId: created.id,
    details: { title, publish, fanout },
  });

  return NextResponse.json({ ok: true, announcement: created, fanout });
}
