import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { browseVideos } from '@/lib/video/queries';
import { parseVideoSort } from '@/lib/video/types';
import { uniqueVideoSlug } from '@/lib/video/slug';
import { generateVideoSummary } from '@/lib/video/summary';
import { cookies } from 'next/headers';

// GET /api/videos?q=&category=&sort=&page= (login) -> { videos, hasMore, page }
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? undefined;
  const categorySlug = url.searchParams.get('category') ?? undefined;
  const sort = parseVideoSort(url.searchParams.get('sort'));
  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1;

  const result = await browseVideos({ q, categorySlug, sort, page });
  return NextResponse.json({ videos: result.videos, hasMore: result.hasMore, page: result.page });
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  slug: z.string().max(120).optional(),
  summary: z.string().max(2000).optional(),
  descriptionMd: z.string().max(50000).optional(),
  categorySlug: z.string().optional(),
  videoUrl: z.string().min(1).max(2000),
  videoKey: z.string().optional(),
  posterUrl: z.string().max(2000).optional(),
  posterKey: z.string().optional(),
  previewUrl: z.string().max(2000).optional(),
  previewKey: z.string().optional(),
  durationSec: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  mimeType: z.string().optional(),
  transcriptText: z.string().optional(),
  language: z.string().optional(),
  intervieweeName: z.string().optional(),
  intervieweeTitle: z.string().optional(),
  intervieweeOrg: z.string().optional(),
  intervieweeBio: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published']).optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  featured: z.boolean().optional(),
});

// POST /api/videos (admin) -> { ok, slug }
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const d = parsed.data;

  const slug = await uniqueVideoSlug(d.title, d.slug);
  const status = d.status ?? 'draft';

  const category = d.categorySlug
    ? await prisma.videoCategory.findUnique({ where: { slug: d.categorySlug }, select: { id: true } })
    : null;

  // Resolve / create tag rows, then connect.
  const tagNames = Array.from(new Set((d.tags ?? []).map((t) => t.trim()).filter(Boolean)));

  const video = await prisma.video.create({
    data: {
      slug,
      title: d.title,
      summary: d.summary ?? '',
      descriptionMd: d.descriptionMd ?? '',
      videoUrl: d.videoUrl,
      videoKey: d.videoKey,
      posterUrl: d.posterUrl,
      posterKey: d.posterKey,
      previewUrl: d.previewUrl,
      previewKey: d.previewKey,
      durationSec: d.durationSec ?? 0,
      width: d.width,
      height: d.height,
      sizeBytes: d.sizeBytes ?? 0,
      ...(d.mimeType ? { mimeType: d.mimeType } : {}),
      transcriptText: d.transcriptText,
      language: d.language,
      intervieweeName: d.intervieweeName,
      intervieweeTitle: d.intervieweeTitle,
      intervieweeOrg: d.intervieweeOrg,
      intervieweeBio: d.intervieweeBio,
      status,
      visibility: d.visibility ?? 'public',
      featured: d.featured ?? false,
      ...(d.featured ? { featuredAt: new Date() } : {}),
      uploaderId: session.user.id,
      categoryId: category?.id ?? null,
      publishedAt: status === 'published' ? new Date() : null,
      tags: tagNames.length
        ? {
            create: await Promise.all(
              tagNames.map(async (name) => {
                const tagSlug = name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .slice(0, 60) || name;
                const tag = await prisma.videoTag.upsert({
                  where: { slug: tagSlug },
                  create: { slug: tagSlug, name },
                  update: { usageCount: { increment: 1 } },
                });
                return { tagId: tag.id };
              }),
            ),
          }
        : undefined,
    },
    select: { id: true, slug: true },
  });

  // Generate the AI summary ONCE, now (best-effort — upload must not fail if the
  // LLM is unconfigured or errors). Viewers only ever read the cached value.
  try {
    const locale = cookies().get('locale')?.value;
    await generateVideoSummary(video.id, locale);
  } catch {
    /* ignore — can be regenerated later from the admin edit page */
  }

  return NextResponse.json({ ok: true, slug: video.slug });
}
