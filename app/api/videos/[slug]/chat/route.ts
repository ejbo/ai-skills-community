import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError, toSseResponseStream } from '@/lib/llm';
import { canViewVideo, getVideoActor } from '@/lib/video/access';
import { buildVideoChatSystem, buildVideoContext } from '@/lib/video/ai';
import { VIDEO_AI_SELECT, toVideoAiInput, videoAiContextChars } from '@/lib/video/summary';

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
//
// The gate MIRRORS the detail page (canViewVideo): the context handed to the
// model is the description AND the transcript of everything said in the video,
// so "logged in + the slug exists" would have let anyone read a draft or a
// private video back out of the assistant.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const actor = await getVideoActor();
  if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`video-chat:user:${actor.id}`, 60, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const video = await prisma.video.findUnique({
    where: { slug: params.slug },
    select: { ...VIDEO_AI_SELECT, status: true, visibility: true, uploaderId: true, deletedAt: true, isShort: true },
  });
  if (!video || video.deletedAt || !canViewVideo(video, actor)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

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
  const context = buildVideoContext(toVideoAiInput(video), videoAiContextChars());
  const system = buildVideoChatSystem(context, video.aiSummaryMd, locale);

  const deltas = provider.streamDeltas({
    system,
    messages: parsed.data.messages,
    model: parsed.data.model,
    signal: req.signal,
  });

  return new NextResponse(toSseResponseStream(deltas, { signal: req.signal }), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Opts out of nginx's app-wide `proxy_buffering on` for THIS response
      // only — without it the whole answer arrives in one lump at the end.
      'X-Accel-Buffering': 'no',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
