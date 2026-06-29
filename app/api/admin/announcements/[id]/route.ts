import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { fanoutAnnouncement } from '@/lib/notifications';
import { plainSummary } from '@/lib/announcement';

export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().min(1).max(200).optional(),
  bodyMd: z.string().max(40000).optional(),
  publish: z.boolean().optional(), // true → publish (fan out if newly published); false → unpublish
});

// PUT /api/admin/announcements/[id] — edit and/or (un)publish.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const existing = await prisma.announcement.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { title, bodyMd, publish } = parsed.data;
  const wasPublished = existing.publishedAt !== null;
  // Only flip publishedAt when `publish` is explicitly provided.
  const nextPublishedAt =
    publish === undefined ? existing.publishedAt : publish ? existing.publishedAt ?? new Date() : null;

  const updated = await prisma.announcement.update({
    where: { id: params.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(bodyMd !== undefined ? { bodyMd } : {}),
      publishedAt: nextPublishedAt,
    },
  });

  // Fan out only on the unpublished → published transition (never re-blast).
  let fanout = { inApp: 0, email: 0 };
  const newlyPublished = publish === true && !wasPublished;
  if (newlyPublished) {
    fanout = await fanoutAnnouncement({
      announcementId: updated.id,
      actorId: session.user.id,
      title: updated.title,
      summary: plainSummary(updated.bodyMd),
    });
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: newlyPublished ? 'publish_announcement' : 'update_announcement',
    targetType: 'announcement',
    targetId: updated.id,
    details: { title: updated.title, publish, fanout },
  });

  return NextResponse.json({ ok: true, announcement: updated, fanout });
}

// DELETE /api/admin/announcements/[id]
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const existing = await prisma.announcement.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.announcement.delete({ where: { id: params.id } });
  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_announcement',
    targetType: 'announcement',
    targetId: params.id,
    details: { title: existing.title },
  });
  return NextResponse.json({ ok: true });
}
