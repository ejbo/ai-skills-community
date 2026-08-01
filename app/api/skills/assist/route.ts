import { NextResponse } from 'next/server';
import { explainParseFailure } from '@/lib/llm/explain';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getProvider, LLMConfigError, type LLMCompletion } from '@/lib/llm';
import {
  assistInputSchema,
  buildAssistContext,
  buildPackAssistContext,
  buildAssistPrompt,
  parseAssistResult,
  isAssistAction,
  ASSIST_CONTEXT_CHARS,
} from '@/lib/skill-assist';
import { estimateTokenCost } from '@/lib/skill-parser';

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
  const { action, skillMd, readme, files, packSkills, current } = parsed.data;
  if (!isAssistAction(action)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Token-cost estimation is a size computation (≈4 chars/token) — answering it
  // with an LLM round-trip over the full skill was the slowest assist action for
  // zero accuracy gain. Compute it deterministically and return instantly.
  if (action === 'tokens') {
    const fullContext = buildAssistContext({ skillMd: skillMd ?? '', readme, files });
    return NextResponse.json(
      { ok: true, result: { tokenCost: estimateTokenCost(fullContext) } },
      { headers: { 'x-ratelimit-remaining': String(gate.remaining) } },
    );
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

  // `pack` reads the member-skill list; every other action reads only a
  // per-action slice of the skill (ASSIST_CONTEXT_CHARS) so generation stays
  // fast on large skills — metadata never needs the whole bundle.
  const context =
    action === 'pack'
      ? buildPackAssistContext(packSkills ?? [])
      : buildAssistContext({ skillMd: skillMd ?? '', readme, files }, ASSIST_CONTEXT_CHARS[action]);
  const prompt = buildAssistPrompt(action, context, current ?? {});

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

  const result = parseAssistResult(action, out.text, context);
  // An empty result means the model returned no parseable JSON. explainParseFailure
  // separates the three causes — budget truncation, reasoning-only reply, or a real
  // format violation — because "模型未返回可用的 JSON 结果" sent everyone hunting the
  // wrong one. (`tokens` never gets here — it short-circuits above with no LLM call.)
  if (Object.keys(result).length === 0) {
    return NextResponse.json(
      {
        error: 'llm_no_result',
        reason: explainParseFailure('AI 生成失败', out),
        raw: (out.text || out.reasoning || '').slice(0, 300),
      },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { ok: true, result },
    { headers: { 'x-ratelimit-remaining': String(gate.remaining) } },
  );
}
