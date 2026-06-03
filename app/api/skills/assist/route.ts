import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError } from '@/lib/llm';
import {
  buildAssistContext,
  buildAssistPrompt,
  parseAssistResult,
  isAssistAction,
} from '@/lib/skill-assist';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.string().refine(isAssistAction, 'unknown action'),
  skillMd: z.string().min(1).max(200_000),
  readme: z.string().max(200_000).optional().nullable(),
  files: z
    .array(z.object({ path: z.string().max(400), content: z.string().max(200_000) }))
    .max(50)
    .optional(),
  current: z
    .object({
      name: z.string().optional(),
      summary: z.string().optional(),
      descriptionMd: z.string().optional(),
      tags: z.array(z.string()).optional(),
      triggers: z.array(z.string()).optional(),
    })
    .optional(),
});

const HOUR_MS = 60 * 60 * 1000;

// Authenticated AI metadata assist. Operates purely on client-provided skill
// text (no DB read) so it works the same for an unsaved upload and an existing
// skill the owner is editing. Same LLM provider as Chat / Comparison.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const gate = rateLimit(`skill-assist:${session.user.id}`, 60, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '请求过于频繁，请稍后再试', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.flatten() }, { status: 400 });
  }
  const { action, skillMd, readme, files, current } = parsed.data;
  if (!isAssistAction(action)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  const context = buildAssistContext({ skillMd, readme, files });
  const prompt = buildAssistPrompt(action, context, current ?? {});

  let text: string;
  try {
    const out = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: prompt.maxTokens,
    });
    text = out.text;
  } catch (e) {
    return NextResponse.json(
      { error: 'llm_error', reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
      { status: 502 },
    );
  }

  const result = parseAssistResult(action, text, context);
  return NextResponse.json(
    { ok: true, result },
    { headers: { 'x-ratelimit-remaining': String(gate.remaining) } },
  );
}
