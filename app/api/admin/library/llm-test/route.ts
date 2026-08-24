import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { getLibraryProvider } from '@/lib/library/llm';
import { describeLlmRoute } from '@/lib/llm/egress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live probe of the 知识库 AI model — the LLM twin of the SMTP 诊断. It runs a
 * real (tiny) completion through the exact provider the indexer uses and
 * returns the RAW error, because everything downstream collapses it into a
 * blank "解析失败" on the doc row.
 */
export async function POST() {
  const gate = await gateApi('library');
  if (!gate.ok) return gate.response;

  const started = Date.now();
  let route: ReturnType<typeof describeLlmRoute> | null = null;
  try {
    const { provider, model } = await getLibraryProvider();
    route = describeLlmRoute(
      // Providers keep baseUrl private; the route only depends on the host, and
      // describeLlmRoute tolerates a null.
      (provider as unknown as { baseUrl?: string }).baseUrl ?? null,
    );
    const out = await provider.complete({
      messages: [{ role: 'user', content: '回复 OK 两个字符，不要其他内容。' }],
      // A reasoning model burns far more than a handful of tokens inside <think>
      // before the first content token — a tight cap here would make the probe
      // report an empty reply for a perfectly healthy model, i.e. misdiagnose
      // exactly the failure it exists to diagnose.
      maxTokens: 2000,
    });
    return NextResponse.json({
      ok: true,
      provider: provider.id,
      model: model ?? provider.model,
      route,
      reply: out.text.trim().slice(0, 120),
      finishReason: out.finishReason ?? null,
      // > 0 proves the server runs a --reasoning-parser (thinking is split out
      // of `content`). 0 with a reasoning model means it is inlined instead.
      reasoningChars: out.reasoning?.length ?? 0,
      usage: out.usage,
      ms: Date.now() - started,
    });
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    return NextResponse.json(
      {
        ok: false,
        route,
        name: err.name,
        message: err.message,
        cause: err.cause instanceof Error ? err.cause.message : null,
        ms: Date.now() - started,
      },
      { status: 502 },
    );
  }
}
