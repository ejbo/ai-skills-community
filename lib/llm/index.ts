import { env } from '@/lib/env';
import { resolveLLMConfig } from './config';
import { AnthropicProvider } from './anthropic';
import { OpenAiProvider } from './openai';
import type { LLMProvider } from './types';

export type { LLMProvider, LLMMessage, LLMCompleteOptions, LLMUsage } from './types';
export { toSseResponseStream } from './sse';
export { resolveLLMConfig } from './config';

/** Thrown when the active LLM env configuration is incomplete. */
export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMConfigError';
  }
}

let cached: LLMProvider | null = null;

/** Returns true when the env has enough to talk to a provider. */
export function isLLMConfigured(): boolean {
  const cfg = resolveLLMConfig(env);
  if (!cfg.model || !cfg.baseUrl) return false;
  // Anthropic needs a key; an OpenAI-compatible endpoint (e.g. an internal vLLM/SGLang
  // server) is commonly keyless, so base URL + model is enough.
  return cfg.provider === 'anthropic' ? Boolean(cfg.apiKey) : true;
}

/** The active provider, built once from env. Throws LLMConfigError if unconfigured. */
export function getProvider(): LLMProvider {
  if (cached) return cached;
  const cfg = resolveLLMConfig(env);
  if (!cfg.baseUrl) {
    throw new LLMConfigError('服务端未配置 LLM base URL（设置 LLM_BASE_URL）');
  }
  if (!cfg.model) {
    throw new LLMConfigError('服务端未配置 LLM 模型（设置 LLM_MODEL）');
  }
  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey) {
      throw new LLMConfigError('服务端未配置 LLM API key（设置 LLM_API_KEY 或 ANTHROPIC_API_KEY）');
    }
    cached = new AnthropicProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
  } else {
    // OpenAI-compatible: apiKey may be undefined/empty (internal keyless model).
    cached = new OpenAiProvider({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
  }
  return cached;
}
