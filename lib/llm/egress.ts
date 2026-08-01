/**
 * Network layer for LLM calls.
 *
 * Routing: DIRECT by default. On the intranet deploy the model is an internal
 * endpoint (vLLM/SGLang on the corporate network) and the proxy cannot reach
 * it — and internal networks do not necessarily use RFC1918 addresses, so the
 * generic bypass list in lib/net/proxy can't be trusted to classify them.
 * `LLM_USE_PROXY=true` opts into per-host routing for a model that genuinely
 * lives on the public internet (api.anthropic.com and friends).
 *
 * Errors: Node's global fetch throws a bare `TypeError: fetch failed` and hides
 * the real reason in `.cause`, so an unreachable model used to reach the admin
 * as a blank "解析失败" on the doc row. Every failure here is rewritten to name
 * the endpoint, the route taken and the underlying errno.
 */

import { env } from '@/lib/env';
import { egressFor } from '@/lib/net/proxy';

export class LLMNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMNetworkError';
  }
}

function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

export const llmFetch: typeof fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  const url =
    typeof input === 'string' || input instanceof URL ? String(input) : (input as Request).url;
  const eg = env.LLM_USE_PROXY
    ? egressFor(url)
    : ({ dispatcher: undefined, via: 'direct', proxyUri: null } as const);

  try {
    return await fetch(
      input,
      eg.dispatcher ? ({ ...(init ?? {}), dispatcher: eg.dispatcher } as RequestInit) : init,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { cause?: unknown };
    const cause = err?.cause instanceof Error ? (err.cause as NodeJS.ErrnoException) : undefined;
    const code = err?.code ?? cause?.code ?? '';
    const detail = [err?.message, cause?.message].filter(Boolean).join(' ← ');
    const route = eg.via === 'proxy' ? `经代理 ${eg.proxyUri}` : '直连';
    const hint =
      eg.via === 'proxy'
        ? '内网模型不要走代理：把 LLM_USE_PROXY 设为 false，或把模型地址加入 PROXY_BYPASS'
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? '外网模型需要设置 LLM_USE_PROXY=true'
          : '检查模型地址与端口是否可从本机直接访问';
    console.error('[llm] request failed', { url, via: eg.via, proxy: eg.proxyUri, code, detail });
    throw new LLMNetworkError(
      `调用模型失败（${route} ${endpointOf(url)}）：${code ? `${code} ` : ''}${detail}。${hint}`,
      { cause: e },
    );
  }
}) as typeof fetch;

/** Where an LLM base URL will actually go — for the admin diagnostics. */
export function describeLlmRoute(baseUrl: string | null | undefined) {
  if (!baseUrl) return { via: 'direct' as const, proxyUri: null, useProxy: env.LLM_USE_PROXY };
  const eg = env.LLM_USE_PROXY
    ? egressFor(baseUrl)
    : ({ via: 'direct', proxyUri: null } as const);
  return { via: eg.via, proxyUri: eg.proxyUri, useProxy: env.LLM_USE_PROXY };
}
