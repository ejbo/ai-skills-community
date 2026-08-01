// Admin-configurable LLM for 知识库 AI (indexing + chat). The single
// LibrarySetting row overrides the env provider when complete; otherwise falls
// back to lib/llm's getProvider(). Cached briefly so hot paths don't hit the
// DB per call; the admin settings route busts the cache on save.

import { prisma } from '@/lib/db';
import { getProvider, type LLMProvider } from '@/lib/llm';
import { AnthropicProvider } from '@/lib/llm/anthropic';
import { OpenAiProvider } from '@/lib/llm/openai';
import { llmFetch } from '@/lib/llm/egress';

const CACHE_MS = 60_000;

interface SettingRow {
  llmProvider: string | null;
  llmBaseUrl: string | null;
  llmApiKey: string | null;
  llmModel: string | null;
}

let cache: { provider: LLMProvider; model: string | null; at: number } | null = null;

export function bustLibraryLlmCache(): void {
  cache = null;
}

async function loadSetting(): Promise<SettingRow | null> {
  try {
    return await prisma.librarySetting.findUnique({
      where: { id: 'default' },
      select: { llmProvider: true, llmBaseUrl: true, llmApiKey: true, llmModel: true },
    });
  } catch {
    return null; // table missing (migration not applied) → env fallback
  }
}

function buildOverride(s: SettingRow): LLMProvider | null {
  const baseUrl = s.llmBaseUrl?.trim();
  const model = s.llmModel?.trim();
  const apiKey = s.llmApiKey?.trim() || undefined;
  if (!baseUrl || !model) return null;
  // llmFetch: direct unless LLM_USE_PROXY — the admin-editable base URL is
  // normally the internal model, which the corporate proxy cannot reach.
  if (s.llmProvider === 'anthropic') {
    if (!apiKey) return null;
    return new AnthropicProvider({ apiKey, baseUrl, model, fetchImpl: llmFetch });
  }
  return new OpenAiProvider({ apiKey, baseUrl, model, fetchImpl: llmFetch });
}

/**
 * The provider 知识库 AI should use right now. Throws LLMConfigError (from
 * getProvider) only when BOTH the override and the env config are unusable.
 */
export async function getLibraryProvider(): Promise<{ provider: LLMProvider; model: string | null }> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { provider: cache.provider, model: cache.model };
  }
  const setting = await loadSetting();
  const override = setting ? buildOverride(setting) : null;
  const resolved = override
    ? { provider: override, model: setting?.llmModel?.trim() || null }
    : { provider: getProvider(), model: null };
  cache = { ...resolved, at: Date.now() };
  return resolved;
}
