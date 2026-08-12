import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getLibraryProvider } from '@/lib/library/llm';
import { LLMConfigError, type LLMCompletion } from '@/lib/llm';
import { explainParseFailure } from '@/lib/llm/explain';
import { MAX_SHORT_CAPTION_CHARS } from '@/lib/video/shorts-shared';
import { buildShortCaptionPrompt, parseShortCaptionResult } from '@/lib/video/shorts-caption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const schema = z.object({
  draft: z.string().trim().min(1).max(MAX_SHORT_CAPTION_CHARS * 4),
});

// POST /api/shorts/assist (login) — AI 润色: polish a short's draft caption.
// Provider comes from getLibraryProvider() so admins can repoint the model
// (管理后台 → 知识库), falling back to env LLM_*.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`shorts:assist:${session.user.id}`, 30, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  let provider;
  try {
    provider = (await getLibraryProvider()).provider;
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  const prompt = buildShortCaptionPrompt(parsed.data.draft);

  let out: LLMCompletion;
  try {
    out = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: prompt.maxTokens,
      json: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'llm_error', reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
      { status: 502 },
    );
  }

  const caption = parseShortCaptionResult(out.text);
  if (!caption) {
    return NextResponse.json(
      {
        error: 'llm_no_result',
        reason: explainParseFailure('AI 润色失败', out),
        raw: (out.text || out.reasoning || '').slice(0, 300),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, caption },
    { headers: { 'x-ratelimit-remaining': String(gate.remaining) } },
  );
}
