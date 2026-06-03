// Resolves the active LLM configuration from environment variables. Pure and
// env-input-driven so it is trivially testable and so switching providers/models
// never requires touching call sites — only the env.

export type LLMProviderId = 'anthropic' | 'openai-compatible';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export interface LLMConfig {
  provider: LLMProviderId;
  apiKey: string | undefined;
  /** Base URL of the upstream API (no trailing slash assumptions). */
  baseUrl: string;
  model: string;
}

export interface LLMEnvInput {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
}

function normalizeProvider(raw: string | undefined): LLMProviderId {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'openai' || v === 'openai-compatible') return 'openai-compatible';
  return 'anthropic';
}

export function resolveLLMConfig(env: LLMEnvInput): LLMConfig {
  const provider = normalizeProvider(env.LLM_PROVIDER);

  // Only the anthropic provider may borrow the legacy ANTHROPIC_API_KEY.
  const apiKey =
    env.LLM_API_KEY ?? (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined);

  const baseUrl =
    env.LLM_BASE_URL ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : '');

  const model = env.LLM_MODEL ?? (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '');

  return { provider, apiKey, baseUrl, model };
}
