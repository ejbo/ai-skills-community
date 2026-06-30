import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError } from '@/lib/llm';
import {
  assistInputSchema,
  buildAssistContext,
  buildAssistPrompt,
  parseAssistResult,
  isAssistAction,
} from '@/lib/skill-assist';

export const dynamic = 'force-dynamic';

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
  const parsed = assistInputSchema.safeParse(body);
  if (!parsed.success) {
    // Surface the first failing field so the client shows WHY (not a bare "invalid_input").
    const flat = parsed.error.flatten();
    const [firstField, firstErrors] = Object.entries(flat.fieldErrors)[0] ?? [];
    const reason = firstField
      ? `字段「${firstField}」无效：${firstErrors?.[0] ?? ''}`
      : '请求参数无效';
    return NextResponse.json({ error: 'invalid_input', reason, issues: flat }, { status: 400 });
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
  // `tokens` always yields a number (heuristic fallback); for the text actions an empty
  // result means the model returned no parseable JSON (common with local/reasoning models
  // that ignore the "JSON only" instruction). Surface it clearly + echo a snippet so it's
  // debuggable, instead of returning a silent empty result the UI reads as a generic failure.
  if (action !== 'tokens' && Object.keys(result).length === 0) {
    return NextResponse.json(
      { error: 'llm_no_result', reason: '模型未返回可用的 JSON 结果', raw: text.slice(0, 300) },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { ok: true, result },
    { headers: { 'x-ratelimit-remaining': String(gate.remaining) } },
  );
}
