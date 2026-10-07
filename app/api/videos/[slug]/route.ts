import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { deleteVideoFile } from '@/lib/video/storage';
import { generateVideoSubtitles } from '@/lib/video/subtitles';
import { parseCoverAspect, parseCoverPos } from '@/lib/media/cover-pos';
import { parseStoredClip } from '@/lib/media/clip-shared';
import { retireSlug } from '@/lib/slug-server';
import { uniqueVideoSlug } from '@/lib/video/slug';

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  slug: z.string().max(120).optional(),
  summary: z.string().max(2000).optional(),
  descriptionMd: z.string().optional(),
  categorySlug: z.string().nullable().optional(),
  videoUrl: z.string().max(2000).optional(),
  videoKey: z.string().optional(),
  posterUrl: z.string().max(2000).nullable().optional(),
  posterKey: z.string().nullable().optional(),
  previewUrl: z.string().max(2000).nullable().optional(),
  previewKey: z.string().nullable().optional(),
  // 封面版式 + 裁切 — validated by lib/media/cover-pos.ts (the one closed value set).
  posterAspect: z.string().max(20).optional(),
  posterPos: z.string().max(20).optional(),
  // {start,end,cover,duration} of the segment the preview clip was cut from.
  previewClip: z.unknown().optional(),
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
  if (!can(session.user, 'videos')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const d = parsed.data;

  const video = await prisma.video.findUnique({ where: { slug: params.slug } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // 随刷短视频 are moderated via PATCH /api/shorts/[id] (per-field permissions,
  // caption/featured only) — the long-video editor's fields don't apply.
  if (video.isShort) return NextResponse.json({ error: 'not_found' }, { status: 404 });

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

  if (d.posterAspect !== undefined) {
    const aspect = parseCoverAspect(d.posterAspect);
    if (aspect === null) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    data.posterAspect = aspect;
  }
  if (d.posterPos !== undefined) {
    const pos = parseCoverPos(d.posterPos);
    if (pos === null) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    data.posterPos = pos;
  }
  // A removed poster takes its crop with it; a removed / replaced preview clip
  // no longer matches the stored range unless the request names the new one.
  if (d.posterUrl === null) {
    data.posterKey = null;
    data.posterAspect = 'landscape';
    data.posterPos = '';
  }
  if (d.previewKey !== undefined || d.previewUrl === null) {
    const clip = d.previewKey ? parseStoredClip(d.previewClip) : null;
    data.previewClip = clip ? { ...clip } : Prisma.DbNull;
    if (d.previewUrl === null) data.previewKey = null;
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

  // An admin-typed slug goes through the house title-slug rules (docs/contracts/
  // slugs.md): normalized, de-duplicated with -2/-3, and the old one retired so
  // every link already shared keeps resolving.
  if (typeof data.slug === 'string') {
    data.slug = data.slug === video.slug ? video.slug : await uniqueVideoSlug(data.slug, data.slug, video.id);
    if (data.slug === video.slug) delete data.slug;
  }

  const updated = await prisma.video.update({
    where: { id: video.id },
    data,
    select: { id: true, slug: true, status: true, videoKey: true, posterKey: true, previewKey: true, subtitleStatus: true, subtitleManual: true },
  });
  if (updated.slug !== video.slug) await retireSlug('video', video.slug, video.id).catch(() => {});

  // Files this save just orphaned (a re-cut preview, a new poster, a replaced
  // source). Best-effort, AFTER the row points at the new ones, and only when no
  // OTHER row names the key — there is no ownership ledger for these keys.
  for (const [before, after] of [
    [video.videoKey, updated.videoKey],
    [video.posterKey, updated.posterKey],
    [video.previewKey, updated.previewKey],
  ] as const) {
    if (!before || before === after) continue;
    const stillUsed = await prisma.video.count({
      where: { OR: [{ videoKey: before }, { posterKey: before }, { previewKey: before }] },
    });
    if (stillUsed === 0) await deleteVideoFile(before);
  }

  // 字幕: start the pipeline when the video BECOMES published without tracks, or
  // when a published video's source was replaced (its tracks describe the old
  // file). Detached and self-claiming — a second trigger is a no-op.
  // Tracks a person uploaded or corrected (`subtitleManual`) are NEVER regenerated
  // over here: a re-encode of the same talk is a common reason to replace a source,
  // and redoing someone's proofreading silently is worse than leaving it. The edit
  // page's 重新生成 button stays the explicit way.
  const becamePublished = updated.status === 'published' && video.status !== 'published';
  const sourceReplaced = Boolean(updated.videoKey) && updated.videoKey !== video.videoKey;
  if (
    updated.status === 'published' &&
    updated.videoKey &&
    ((becamePublished && (updated.subtitleStatus === 'none' || updated.subtitleStatus === 'failed')) ||
      (sourceReplaced && !updated.subtitleManual))
  ) {
    void generateVideoSubtitles(updated.id);
  }

  return NextResponse.json({ ok: true, slug: updated.slug });
}

// DELETE /api/videos/[slug] (admin) — soft delete + best-effort blob cleanup.
export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!can(session.user, 'videos')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug } });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // 随刷短视频 use DELETE /api/shorts/[id]: soft delete, files KEPT on disk —
  // this route's hard blob cleanup must never run on a short.
  if (video.isShort) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.video.update({ where: { id: video.id }, data: { deletedAt: new Date() } });
  await deleteVideoFile(video.videoKey);
  await deleteVideoFile(video.posterKey);
  await deleteVideoFile(video.previewKey);
  // 字幕 tracks have no other referent than this row.
  await deleteVideoFile(video.subtitleZhKey);
  await deleteVideoFile(video.subtitleEnKey);

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
