import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadAccessContext } from '@/lib/access';
import { buildContextFromSkill } from '@/lib/skill-files';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError } from '@/lib/llm';

export const dynamic = 'force-dynamic';

const schema = z.object({
  taskPrompt: z.string().min(1).max(4000),
  model: z.string().optional(),
});

const HOUR_MS = 60 * 60 * 1000;

// Author-only. Runs the sample task twice with the configured model — once with
// the skill loaded as system context, once as a plain baseline — and returns the
// two real outputs for the comparison workshop to analyze.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const { skill, actor, decision } = await loadAccessContext(params.slug, req);
  if (!skill || skill.deletedAt || !skill.currentVersion) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';
  if (!privileged || !actor) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const gate = rateLimit(`cmp-baseline:${actor.id}`, 30, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '请求过于频繁，请稍后再试', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // The 实测 dual-run emulates having the skill installed; keep more of it than
  // the copywriting call, but still cap it so big skills don't stall the run.
  const context = await buildContextFromSkill(skill, 64 * 1024);
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

  const userMessage = [{ role: 'user' as const, content: parsed.data.taskPrompt }];
  const model = parsed.data.model;
  try {
    const [withRun, withoutRun] = await Promise.all([
      provider.complete({ system: context, messages: userMessage, model }),
      provider.complete({ messages: userMessage, model }),
    ]);
    return NextResponse.json({
      example: {
        taskPrompt: parsed.data.taskPrompt,
        withOutput: withRun.text,
        withoutOutput: withoutRun.text,
      },
      model: model ?? provider.model,
      remaining: gate.remaining,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: 'upstream_failed', reason }, { status: 502 });
  }
}
