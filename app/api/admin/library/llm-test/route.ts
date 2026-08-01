import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
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
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
      maxTokens: 16,
    });
    return NextResponse.json({
      ok: true,
      provider: provider.id,
      model: model ?? provider.model,
      route,
      reply: out.text.trim().slice(0, 120),
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
