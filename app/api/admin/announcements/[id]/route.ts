import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRichTextLimit } from '@/lib/rich-text-limit';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';
import { fanoutAnnouncement } from '@/lib/notifications';
import { plainSummary } from '@/lib/announcement';
import { isSlugConflict, retireSlug } from '@/lib/slug-server';
import { pickAnnouncementSlug } from '@/lib/title-slugs';

export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().min(1).max(200).optional(),
  // RichTextEditor field (AnnouncementEditor maxLength 40000): VISIBLE length, like its counter.
  bodyMd: withRichTextLimit(z.string(), 40000).optional(),
  publish: z.boolean().optional(), // true → publish (fan out if newly published); false → unpublish
});

// PUT /api/admin/announcements/[id] — edit and/or (un)publish.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const gate = await gateApi('announcements');
  if (!gate.ok) return gate.response;
  const { session } = gate;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const existing = await prisma.announcement.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { title, bodyMd, publish } = parsed.data;
  const wasPublished = existing.publishedAt !== null;
  // Only flip publishedAt when `publish` is explicitly provided.
  const nextPublishedAt =
    publish === undefined ? existing.publishedAt : publish ? existing.publishedAt ?? new Date() : null;

  // Title slug (docs/contracts/slugs.md): a draft's slug follows its title; once
  // published it is frozen. A legacy row without one gets it here. A replaced
  // slug is retired (SlugAlias) so any link already handed out still resolves.
  const retitledDraft = !wasPublished && title !== undefined && title !== existing.title;
  const needsSlug = !existing.slug || retitledDraft;
  const write = async () => {
    const slug = needsSlug ? await pickAnnouncementSlug(title ?? existing.title, prisma, existing.id) : existing.slug;
    return prisma.announcement.update({
      where: { id: params.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(bodyMd !== undefined ? { bodyMd } : {}),
        ...(slug !== existing.slug ? { slug } : {}),
        publishedAt: nextPublishedAt,
      },
    });
  };
  const updated = await write().catch((e) => {
    if (needsSlug && isSlugConflict(e)) return write();
    throw e;
  });
  if (existing.slug && updated.slug !== existing.slug) {
    await retireSlug('announcement', existing.slug, existing.id).catch(() => {});
  }

  // Fan out only on the unpublished → published transition (never re-blast).
  let fanout = { inApp: 0, email: 0 };
  const newlyPublished = publish === true && !wasPublished;
  if (newlyPublished) {
    fanout = await fanoutAnnouncement({
      announcementId: updated.id,
      announcementSlug: updated.slug,
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
  const gate = await gateApi('announcements');
  if (!gate.ok) return gate.response;
  const { session } = gate;

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
