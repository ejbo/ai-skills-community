import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadAccessContext } from '@/lib/access';
import { buildContextFromSkill } from '@/lib/skill-files';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError, toSseResponseStream } from '@/lib/llm';
import { buildComparisonSystemPrompt } from '@/lib/comparison';

export const dynamic = 'force-dynamic';

const schema = z.object({
  // Optional: the 实测 (real 装上/不装 dual-run). When absent the model generates
  // the comparison copy from the skill content alone — 实测 is an optional step.
  example: z
    .object({
      taskPrompt: z.string().min(1).max(4000),
      withOutput: z.string().max(20000),
      withoutOutput: z.string().max(20000),
    })
    .nullish(),
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

// Author-only. Streams the analysis chat: the model has the skill + both real
// runs in context and writes / refines the structured comparison report.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const { skill, actor, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  if (!privileged || !actor) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const gate = rateLimit(`cmp-workshop:${actor.id}`, 80, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '请求过于频繁，请稍后再试', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // Writing comparison copy doesn't need the whole skill — a 32KB slice keeps
  // generation fast on large skills (SKILL.md head + highest-ranked files).
  const context = await buildContextFromSkill(skill, 32 * 1024);
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

  const system = buildComparisonSystemPrompt(context, parsed.data.example);
  const deltas = provider.streamDeltas({
    system,
    messages: parsed.data.messages,
    model: parsed.data.model,
    maxTokens: 2048,
  });

  return new NextResponse(toSseResponseStream(deltas), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-ratelimit-remaining': String(gate.remaining),
    },
  });
}
