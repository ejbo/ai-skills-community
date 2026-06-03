import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getProvider, LLMConfigError } from '@/lib/llm';
import {
  buildVideoContext,
  buildVideoSummaryPrompt,
  hasAiGrounding,
  parseVideoSummary,
  videoContextSourceHash,
  type VideoAiInput,
} from '@/lib/video/ai';

function aiInput(video: {
  title: string;
  descriptionMd: string | null;
  transcriptText: string | null;
  tags: { tag: { name: string } }[];
}): VideoAiInput {
  return {
    title: video.title,
    descriptionMd: video.descriptionMd,
    transcriptText: video.transcriptText,
    tags: video.tags.map((t) => t.tag.name),
  };
}

const VIDEO_AI_SELECT = {
  id: true,
  title: true,
  descriptionMd: true,
  transcriptText: true,
  deletedAt: true,
  aiSummaryMd: true,
  aiSummaryModel: true,
  aiSummaryAt: true,
  aiSummarySourceHash: true,
  tags: { select: { tag: { select: { name: true } } } },
} as const;

// GET /api/videos/[slug]/summary (login) — cached, else lazily generate.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: VIDEO_AI_SELECT });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const input = aiInput(video);
  const hash = videoContextSourceHash(input);

  // Serve the cache when present and still matching the current source.
  if (video.aiSummaryMd && video.aiSummarySourceHash === hash) {
    return NextResponse.json({
      summaryMd: video.aiSummaryMd,
      model: video.aiSummaryModel,
      generatedAt: video.aiSummaryAt,
    });
  }

  if (!hasAiGrounding(input)) {
    return NextResponse.json({ summaryMd: '', model: null, generatedAt: null });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured' }, { status: 503 });
    }
    throw e;
  }

  const locale = cookies().get('locale')?.value;
  const prompt = buildVideoSummaryPrompt(buildVideoContext(input), locale);
  const out = await provider.complete({
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: prompt.maxTokens,
  });
  const summaryMd = parseVideoSummary(out.text);
  const generatedAt = new Date();

  // Only persist when nothing newer landed (null cache or stale hash).
  if (!video.aiSummaryMd || video.aiSummarySourceHash !== hash) {
    await prisma.video.update({
      where: { id: video.id },
      data: {
        aiSummaryMd: summaryMd,
        aiSummaryModel: provider.model,
        aiSummaryAt: generatedAt,
        aiSummarySourceHash: hash,
      },
    });
  }

  return NextResponse.json({ summaryMd, model: provider.model, generatedAt });
}

// POST /api/videos/[slug]/summary (admin) — force regenerate.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const video = await prisma.video.findUnique({ where: { slug: params.slug }, select: VIDEO_AI_SELECT });
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const input = aiInput(video);
  if (!hasAiGrounding(input)) {
    return NextResponse.json({ summaryMd: '' });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured' }, { status: 503 });
    }
    throw e;
  }

  const locale = cookies().get('locale')?.value;
  const prompt = buildVideoSummaryPrompt(buildVideoContext(input), locale);
  const out = await provider.complete({
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: prompt.maxTokens,
  });
  const summaryMd = parseVideoSummary(out.text);

  await prisma.video.update({
    where: { id: video.id },
    data: {
      aiSummaryMd: summaryMd,
      aiSummaryModel: provider.model,
      aiSummaryAt: new Date(),
      aiSummarySourceHash: videoContextSourceHash(input),
    },
  });

  return NextResponse.json({ summaryMd });
}
