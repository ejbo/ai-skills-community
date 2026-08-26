import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { zoneContext } from '@/lib/zones/access';
import { extractOfficeHtml, scheduleOfficePreview } from '@/lib/zones/office-preview';
import { OFFICE_PREVIEW_EXTS, extOfName, isOfficePreviewable } from '@/lib/zones/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SlidesHtml = { title: string | null; html: string }[];

// Per-process cache of the office → HTML fallback. Extraction re-parses the
// whole file, so one conversion serves every viewer of the drawer for 10 min;
// failures (null) are cached too so a broken deck is not re-parsed per open.
const SLIDES_TTL_MS = 10 * 60 * 1000;
const SLIDES_CACHE_MAX = 200;
const slidesCache = new Map<string, { at: number; slides: SlidesHtml | null }>();
const inflight = new Map<string, Promise<SlidesHtml | null>>();

function cachedSlides(attachmentId: string, key: string, ext: string): Promise<SlidesHtml | null> {
  const hit = slidesCache.get(attachmentId);
  if (hit && Date.now() - hit.at < SLIDES_TTL_MS) return Promise.resolve(hit.slides);
  const running = inflight.get(attachmentId);
  if (running) return running;

  const job = extractOfficeHtml(key, ext)
    .catch(() => null)
    .then((slides) => {
      slidesCache.set(attachmentId, { at: Date.now(), slides });
      if (slidesCache.size > SLIDES_CACHE_MAX) {
        // Map iterates in insertion order — drop the oldest entries.
        const excess = slidesCache.size - SLIDES_CACHE_MAX;
        let dropped = 0;
        for (const k of slidesCache.keys()) {
          if (dropped++ >= excess) break;
          slidesCache.delete(k);
        }
      }
      inflight.delete(attachmentId);
      return slides;
    });
  inflight.set(attachmentId, job);
  return job;
}

const ATTACHMENT_SELECT = {
  id: true,
  postId: true,
  kind: true,
  key: true,
  name: true,
  mimeType: true,
  previewStatus: true,
  previewUrl: true,
  previewError: true,
  post: {
    select: {
      id: true,
      zoneId: true,
      status: true,
      deletedAt: true,
      authorId: true,
      coauthors: { select: { userId: true } },
    },
  },
} as const;

function attachmentExt(att: { name: string; key: string }): string {
  return extOfName(att.name) || extOfName(att.key);
}

// GET /api/zones/[slug]/attachments/[attachmentId]/preview (canRead of its post)
//   → { id, status, previewUrl, previewError, ext, slidesHtml?: { title, html }[] }
export async function GET(_req: Request, { params }: { params: { slug: string; attachmentId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const att = await prisma.zonePostAttachment.findUnique({
    where: { id: params.attachmentId },
    select: ATTACHMENT_SELECT,
  });
  if (!att || att.post.zoneId !== ctx.zone.id || att.post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const uid = session.user.id;
  const isAuthor = att.post.authorId === uid || att.post.coauthors.some((c) => c.userId === uid);
  const readable = (att.post.status === 'published' && ctx.access.canRead) || isAuthor || ctx.access.canModerate;
  if (!readable) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const ext = attachmentExt(att);
  const base = {
    id: att.id,
    status: att.previewStatus,
    previewUrl: att.previewUrl,
    previewError: att.previewError,
    ext,
  };

  // Office files without a PDF rendition (no LibreOffice, still converting, or
  // failed) get the per-slide/section HTML fallback so the drawer can still
  // show something readable.
  if (att.kind === 'file' && att.previewStatus !== 'ready' && OFFICE_PREVIEW_EXTS.has(ext)) {
    const slides = await cachedSlides(att.id, att.key, ext);
    return NextResponse.json({ ...base, slidesHtml: slides ?? undefined });
  }
  return NextResponse.json(base);
}

// POST /api/zones/[slug]/attachments/[attachmentId]/preview (author / co-author / canModerate)
//   re-schedules the LibreOffice conversion → { ok, status: 'pending' }
export async function POST(_req: Request, { params }: { params: { slug: string; attachmentId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const att = await prisma.zonePostAttachment.findUnique({
    where: { id: params.attachmentId },
    select: ATTACHMENT_SELECT,
  });
  if (!att || att.post.zoneId !== ctx.zone.id || att.post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const uid = session.user.id;
  const isAuthor = att.post.authorId === uid || att.post.coauthors.some((c) => c.userId === uid);
  if (!isAuthor && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ext = attachmentExt(att);
  if (att.kind !== 'file' || !isOfficePreviewable(ext)) {
    return NextResponse.json(
      { error: 'unsupported_type', reason: await apiReason('zone_preview_unsupported') },
      { status: 400 },
    );
  }

  // A retry after a fixed file / newly installed soffice must not serve the
  // stale HTML fallback either.
  slidesCache.delete(att.id);
  scheduleOfficePreview(att.id);
  return NextResponse.json({ ok: true, status: 'pending' });
}
