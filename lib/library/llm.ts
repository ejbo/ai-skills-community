// Admin-configurable LLM for 知识库 AI (indexing + chat). The single
// LibrarySetting row overrides the env provider when complete; otherwise falls
// back to lib/llm's getProvider(). Cached briefly so hot paths don't hit the
// DB per call; the admin settings route busts the cache on save.

import { prisma } from '@/lib/db';
import { getProvider, type LLMProvider } from '@/lib/llm';
import { AnthropicProvider } from '@/lib/llm/anthropic';
import { OpenAiProvider } from '@/lib/llm/openai';
import { egressFetch } from '@/lib/net/proxy';

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
  // egressFetch: the base URL is admin-editable, so it may be an external
  // endpoint (needs the corporate proxy) or an internal one (must stay direct).
  if (s.llmProvider === 'anthropic') {
    if (!apiKey) return null;
    return new AnthropicProvider({ apiKey, baseUrl, model, fetchImpl: egressFetch });
  }
  return new OpenAiProvider({ apiKey, baseUrl, model, fetchImpl: egressFetch });
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
