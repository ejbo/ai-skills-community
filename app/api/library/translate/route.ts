import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { LLMConfigError } from '@/lib/llm';
import { getLibraryProvider } from '@/lib/library/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const schema = z.object({
  text: z.string().trim().min(1).max(3000),
});

// POST /api/library/translate (login) — selection translation for the reader.
// Direction is automatic: 中文 → English, anything else → 中文.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:translate:${session.user.id}`, 60, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

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

  try {
    const out = await provider.complete({
      system:
        '你是精准的翻译引擎。判断输入语言：中文则翻译为英文，其他语言则翻译为简体中文。' +
        '保留术语、代码与专有名词的原文形态。只输出译文，不要任何解释或前后缀。',
      messages: [{ role: 'user', content: parsed.data.text }],
      maxTokens: 1500,
    });
    const translation = out.text.trim();
    if (!translation) return NextResponse.json({ error: 'llm_no_result' }, { status: 502 });
    return NextResponse.json({ ok: true, translation });
  } catch (e) {
    return NextResponse.json(
      { error: 'llm_error', reason: (e as Error).message.slice(0, 200) },
      { status: 502 },
    );
  }
}
