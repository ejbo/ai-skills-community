// 站内翻译 — the provider SLOT (docs/translation-design.md §3.2).
//
// Resolution order:
//   1. env `TRANSLATE_LLM_BASE_URL` + `TRANSLATE_LLM_MODEL` — a DEDICATED model,
//      ideally a non-reasoning MT model on its own port (kind 'mt');
//   2. the house 知识库 model (`getLibraryProvider`, admin-repointable) as kind
//      'general'. Acceptable only with 管理后台 → 知识库 → 关闭思考 on: a reasoning
//      model spends 500–1000 chain-of-thought tokens per snippet.
// `TRANSLATE_ENABLED=false` is the kill switch. Built ONLY through OpenAiProvider
// with `llmFetch` (DIRECT egress unless LLM_USE_PROXY) — never a bare fetch.

import { env } from '@/lib/env';
import { LLMConfigError, type LLMProvider } from '@/lib/llm';
import { llmFetch } from '@/lib/llm/egress';
import { OpenAiProvider } from '@/lib/llm/openai';
import { getLibraryProvider } from '@/lib/library/llm';

export interface TranslationSlot {
  provider: LLMProvider;
  /** Chooses the prompt shape (lib/translate/prompts.ts). */
  kind: 'mt' | 'general';
  /** Served model id — stored on cache rows (purge-by-model). */
  model: string;
  /** Shown in 「译自中文 · <label>」. */
  label: string;
  /** The house 知识库 model is doing the translating: same GPU and queue as 知识库 chat ⇒ tighter concurrency. */
  isLibraryFallback: boolean;
}

const CACHE_MS = 60_000;
let cached: { slot: TranslationSlot; at: number } | null = null;

export function bustTranslationSlotCache(): void {
  cached = null;
}

/** The slot to translate with right now. Throws LLMConfigError when disabled or nothing is configured. */
export async function getTranslationSlot(): Promise<TranslationSlot> {
  if (!env.TRANSLATE_ENABLED) throw new LLMConfigError('站内翻译已关闭（TRANSLATE_ENABLED=false）');
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.slot;

  let slot: TranslationSlot;
  if (env.TRANSLATE_LLM_BASE_URL && env.TRANSLATE_LLM_MODEL) {
    slot = {
      provider: new OpenAiProvider({
        apiKey: env.TRANSLATE_LLM_API_KEY,
        baseUrl: env.TRANSLATE_LLM_BASE_URL,
        model: env.TRANSLATE_LLM_MODEL,
        fetchImpl: llmFetch,
      }),
      kind: env.TRANSLATE_LLM_KIND === 'general' ? 'general' : 'mt',
      model: env.TRANSLATE_LLM_MODEL,
      label: env.TRANSLATE_ENGINE_LABEL ?? env.TRANSLATE_LLM_MODEL,
      isLibraryFallback: false,
    };
  } else {
    const lib = await getLibraryProvider(); // throws LLMConfigError when nothing is configured
    const model = lib.model ?? lib.provider.model;
    slot = { provider: lib.provider, kind: 'general', model, label: env.TRANSLATE_ENGINE_LABEL ?? model, isLibraryFallback: true };
  }
  cached = { slot, at: Date.now() };
  return slot;
}

/** For the UI: is there anything to translate with? Never throws (no dead buttons, no 500 on a page render). */
export async function translationStatus(): Promise<{ available: boolean; engine: string | null }> {
  try {
    const slot = await getTranslationSlot();
    return { available: true, engine: slot.label };
  } catch {
    return { available: false, engine: null };
  }
}

/** Concurrent model calls translation may hold — 2 on the library fallback (it is the 知识库 chat's GPU and queue). */
export function translationConcurrency(slot: Pick<TranslationSlot, 'isLibraryFallback'>): number {
  return slot.isLibraryFallback ? Math.min(2, env.TRANSLATE_MAX_CONCURRENT) : env.TRANSLATE_MAX_CONCURRENT;
}
