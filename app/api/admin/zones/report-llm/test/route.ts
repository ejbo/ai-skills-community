import { NextResponse } from 'next/server';
import { gateApi } from '@/lib/admin';
import { describeLlmRoute } from '@/lib/llm/egress';
import { bustReportLlmCache, getReportProvider } from '@/lib/zones/reports/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 真实调用一次「版块报告」当前生效的模型（和 /api/admin/library/llm-test 同款）：
 * 返回走的是哪份配置（reports / library）、直连还是经代理、原始错误。
 * 要求模型回一个 JSON——报告流水线每一步都要 JSON，这里顺便验证 JSON 模式真的可用。
 */
export async function POST() {
  const gate = await gateApi('zones');
  if (!gate.ok) return gate.response;

  const started = Date.now();
  let route: ReturnType<typeof describeLlmRoute> | null = null;
  let source: 'reports' | 'library' | null = null;
  try {
    bustReportLlmCache();
    const resolved = await getReportProvider();
    source = resolved.source;
    route = describeLlmRoute(resolved.baseUrl);
    const out = await resolved.provider.complete({
      messages: [{ role: 'user', content: '只输出一个 JSON 对象：{"ok":true}，不要其他内容。' }],
      maxTokens: 2000,
      json: true,
    });
    const text = out.text.trim();
    let jsonOk = false;
    try {
      jsonOk = Boolean((JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { ok?: unknown }).ok);
    } catch {
      jsonOk = false;
    }
    return NextResponse.json({
      ok: true,
      source,
      provider: resolved.provider.id,
      model: resolved.model ?? resolved.provider.model,
      route,
      reply: text.slice(0, 120),
      jsonOk,
      finishReason: out.finishReason ?? null,
      reasoningChars: out.reasoning?.length ?? 0,
      ms: Date.now() - started,
    });
  } catch (e) {
    const err = e as Error & { cause?: unknown };
    return NextResponse.json(
      { ok: false, source, route, name: err.name, message: err.message, cause: err.cause instanceof Error ? err.cause.message : null, ms: Date.now() - started },
      { status: 502 },
    );
  }
}
