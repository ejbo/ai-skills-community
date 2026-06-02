import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { loadAccessContext, accessDenial } from '@/lib/access';
import { buildContextFromSkill } from '@/lib/skill-files';

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

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'try_disabled', reason: '服务端未配置 ANTHROPIC_API_KEY' },
      { status: 503 },
    );
  }

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

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: parsed.data.model ?? DEFAULT_MODEL,
      max_tokens: 1024,
      stream: true,
      system: [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }],
      messages: parsed.data.messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: 'upstream_failed', reason: `Anthropic ${upstream.status}: ${text.slice(0, 240)}` },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
