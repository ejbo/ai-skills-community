import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { LLMConfigError } from '@/lib/llm';
import { generateVideoSummary } from '@/lib/video/summary';

// GET /api/videos/[slug]/summary (login) — returns the CACHED summary only.
// Generation happens once at upload (see POST /api/videos) or via admin POST
// below; it is never triggered by a viewer.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({
    where: { slug: params.slug },
    select: { deletedAt: true, aiSummaryMd: true, aiSummaryModel: true, aiSummaryAt: true },
  });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    summaryMd: video.aiSummaryMd ?? '',
    model: video.aiSummaryModel,
    generatedAt: video.aiSummaryAt,
  });
}

// POST /api/videos/[slug]/summary (admin) — force regenerate.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const video = await prisma.video.findUnique({
    where: { slug: params.slug },
    select: { id: true, deletedAt: true },
  });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = cookies().get('locale')?.value;
  try {
    const result = await generateVideoSummary(video.id, locale);
    return NextResponse.json({ summaryMd: result?.summaryMd ?? '' });
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'generation_failed' }, { status: 500 });
  }
}
