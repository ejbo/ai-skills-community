import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { loadAccessContext, accessDenial } from '@/lib/access';
import { buildContextFromSkill } from '@/lib/skill-files';
import { getProvider, LLMConfigError, toSseResponseStream } from '@/lib/llm';

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

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const { skill, actor, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  // Drafts are chattable only by the owner/admin.
  if (skill.status !== 'published' && !privileged) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Restricted / private skills require content access (public stays open).
  if (skill.visibility !== 'public' && !decision.canContent) {
    const denial = accessDenial(decision, params.slug, url.origin);
    return NextResponse.json(denial.body, { status: denial.status });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = actor ? `chat:user:${actor.id}` : `chat:ip:${ip}`;
  const limit = actor ? 60 : 10;
  const gate = rateLimit(key, limit, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '请求过于频繁，请稍后再试', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const context = await buildContextFromSkill(skill);
  if (context === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let provider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  const deltas = provider.streamDeltas({
    system: context,
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
