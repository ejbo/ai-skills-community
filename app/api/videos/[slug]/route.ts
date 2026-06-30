import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { deleteVideoFile } from '@/lib/video/storage';

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  slug: z.string().max(120).optional(),
  summary: z.string().max(2000).optional(),
  descriptionMd: z.string().optional(),
  categorySlug: z.string().nullable().optional(),
  videoUrl: z.string().max(2000).optional(),
  videoKey: z.string().optional(),
  posterUrl: z.string().max(2000).nullable().optional(),
  posterKey: z.string().optional(),
  previewUrl: z.string().max(2000).nullable().optional(),
  previewKey: z.string().nullable().optional(),
  durationSec: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  mimeType: z.string().optional(),
  transcriptText: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  intervieweeName: z.string().nullable().optional(),
  intervieweeTitle: z.string().nullable().optional(),
  intervieweeOrg: z.string().nullable().optional(),
  intervieweeBio: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published']).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  featured: z.boolean().optional(),
});

// PATCH /api/videos/[slug] (admin) -> { ok }
export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const d = parsed.data;

  const video = await prisma.video.findUnique({ where: { slug: params.slug } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const key of [
    'title',
    'slug',
    'summary',
    'descriptionMd',
    'videoUrl',
    'videoKey',
    'posterUrl',
    'posterKey',
    'previewUrl',
    'previewKey',
    'durationSec',
    'width',
    'height',
    'sizeBytes',
    'mimeType',
    'transcriptText',
    'language',
    'intervieweeName',
    'intervieweeTitle',
    'intervieweeOrg',
    'intervieweeBio',
    'visibility',
  ] as const) {
    if (d[key] !== undefined) data[key] = d[key];
  }

  if (d.categorySlug !== undefined) {
    const category = d.categorySlug
      ? await prisma.videoCategory.findUnique({ where: { slug: d.categorySlug }, select: { id: true } })
      : null;
    data.categoryId = category?.id ?? null;
  }

  if (d.featured !== undefined) {
    data.featured = d.featured;
    data.featuredAt = d.featured ? video.featuredAt ?? new Date() : null;
  }

  if (d.status !== undefined) {
    data.status = d.status;
    // Stamp publishedAt the first time it transitions to published.
    if (d.status === 'published' && !video.publishedAt) data.publishedAt = new Date();
  }

  if (d.tags !== undefined) {
    const tagNames = Array.from(new Set(d.tags.map((t) => t.trim()).filter(Boolean)));
    await prisma.videoTagOnVideo.deleteMany({ where: { videoId: video.id } });
    const connections = await Promise.all(
      tagNames.map(async (name) => {
        const tagSlug =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || name;
        const tag = await prisma.videoTag.upsert({
          where: { slug: tagSlug },
          create: { slug: tagSlug, name },
          update: {},
        });
        return { tagId: tag.id };
      }),
    );
    data.tags = { create: connections };
  }

  await prisma.video.update({ where: { id: video.id }, data });
  return NextResponse.json({ ok: true });
}

// DELETE /api/videos/[slug] (admin) — soft delete + best-effort blob cleanup.
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.video.update({ where: { id: video.id }, data: { deletedAt: new Date() } });
  await deleteVideoFile(video.videoKey);
  await deleteVideoFile(video.posterKey);
  await deleteVideoFile(video.previewKey);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  await logAdmin({
    adminUserId: session.user.id,
    action: 'video.delete',
    targetType: 'video',
    targetId: video.id,
    details: { slug: video.slug, title: video.title },
    ip,
  });

  return NextResponse.json({ ok: true });
}
