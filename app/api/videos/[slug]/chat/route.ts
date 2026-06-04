import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError, toSseResponseStream } from '@/lib/llm';
import { getVideoBySlug } from '@/lib/video/queries';
import { buildVideoChatSystem, buildVideoContext } from '@/lib/video/ai';

export const dynamic = 'force-dynamic';

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  model: z.string().optional(),
});

const HOUR_MS = 60 * 60 * 1000;

// POST /api/videos/[slug]/chat (login, SSE) — grounded "ask about this video" chat.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`video-chat:user:${session.user.id}`, 60, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const video = await getVideoBySlug(params.slug);
  if (!video || video.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  let provider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  const locale = cookies().get('locale')?.value;
  const context = buildVideoContext({
    title: video.title,
    descriptionMd: video.descriptionMd,
    transcriptText: video.transcriptText,
    tags: video.tags.map((t) => t.tag.name),
  });
  const system = buildVideoChatSystem(context, video.aiSummaryMd, locale);

  const deltas = provider.streamDeltas({
    system,
    messages: parsed.data.messages,
    model: parsed.data.model,
  });

  return new NextResponse(toSseResponseStream(deltas), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
