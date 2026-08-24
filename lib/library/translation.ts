// 译文 — the shared translation cache.
//
// One passage is paid for ONCE, for the whole community: every translation is
// keyed by (doc, target language, hash of the whitespace-normalized source), so
// a sentence one reader translated is instant for every reader after them, and
// the whole-document pass fills exactly the rows on-demand selection
// translation reads from. Nothing here decides WHEN to translate — that is the
// caller's policy (ingest pass vs. a reader clicking 翻译).

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { LLMProvider } from '@/lib/llm';
import { parseTranslatedPassages, translatePassagesPrompt } from './ai-prompts';

export type TargetLang = 'zh' | 'en';

/** Passages per LLM call. Small enough that one bad reply loses little. */
const BATCH = 12;
/** Hard ceiling per passage — a selection longer than this is truncated. */
export const MAX_PASSAGE_CHARS = 6000;

/**
 * A doc is translated INTO the other language. `detectLanguage` gives 'zh' |
 * 'en' | null; anything that is not 中文 is translated into 中文, matching the
 * existing selection-translate behaviour.
 */
export function targetLangFor(docLanguage: string | null | undefined): TargetLang {
  return docLanguage === 'zh' ? 'en' : 'zh';
}

/**
 * Cache key normalization. Collapsing whitespace means the same sentence hits
 * the same row whether it arrived from a DOM selection (single spaces) or from
 * a block of stored HTML (newlines and indentation).
 */
export function normalizeSource(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function sourceHash(text: string): string {
  return createHash('sha256').update(normalizeSource(text)).digest('hex');
}

/** Cached translations for these passages, keyed by NORMALIZED source text. */
export async function lookupTranslations(
  docId: string,
  targetLang: TargetLang,
  passages: string[],
): Promise<Map<string, string>> {
  const byHash = new Map<string, string>();
  for (const p of passages) {
    const norm = normalizeSource(p);
    if (norm) byHash.set(sourceHash(norm), norm);
  }
  if (byHash.size === 0) return new Map();
  const rows = await prisma.libraryTranslation.findMany({
    where: { docId, targetLang, sourceHash: { in: [...byHash.keys()] } },
    select: { sourceHash: true, text: true },
  });
  const out = new Map<string, string>();
  for (const row of rows) {
    const norm = byHash.get(row.sourceHash);
    if (norm) out.set(norm, row.text);
  }
  return out;
}

/** Persist translations. Duplicates are ignored — two readers may race. */
export async function saveTranslations(
  docId: string,
  targetLang: TargetLang,
  entries: { source: string; text: string }[],
): Promise<void> {
  const rows = entries
    .map((e) => ({ source: normalizeSource(e.source), text: e.text.trim() }))
    .filter((e) => e.source && e.text)
    .map((e) => ({
      docId,
      targetLang,
      sourceHash: sourceHash(e.source),
      sourceText: e.source.slice(0, MAX_PASSAGE_CHARS),
      text: e.text,
    }));
  if (rows.length === 0) return;
  await prisma.libraryTranslation.createMany({ data: rows, skipDuplicates: true }).catch(() => {});
}

/** Translate passages with the model, in batches. Missing indices are dropped. */
async function translateUncached(
  provider: LLMProvider,
  passages: string[],
  targetLang: TargetLang,
  onUsage?: (input: number, output: number) => void,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < passages.length; i += BATCH) {
    const batch = passages.slice(i, i + BATCH);
    const prompt = translatePassagesPrompt({ targetLang, passages: batch });
    // No maxTokens: a capped reply is what truncates a reasoning model
    // mid-<think> and loses the whole batch (see CLAUDE.md's LLM invariants).
    const reply = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      json: true,
    });
    if (reply.usage) onUsage?.(reply.usage.input, reply.usage.output);
    const parsed = parseTranslatedPassages(reply.text);
    for (const [idx, text] of parsed) {
      const source = batch[idx];
      if (source) out.set(source, text);
    }
  }
  return out;
}

export interface TranslateResult {
  /** NORMALIZED source → translation. Missing keys were not translatable. */
  bySource: Map<string, string>;
  /** How many passages the model was actually asked about. */
  translated: number;
  /** How many came straight from the cache. */
  cached: number;
}

/**
 * Cache-first translation. Returns a map keyed by NORMALIZED source text, so
 * callers look results up with `normalizeSource(theirText)`.
 */
export async function translateWithCache(opts: {
  docId: string;
  targetLang: TargetLang;
  passages: string[];
  provider: LLMProvider;
  onUsage?: (input: number, output: number) => void;
}): Promise<TranslateResult> {
  const wanted = [...new Set(opts.passages.map(normalizeSource).filter(Boolean))];
  if (wanted.length === 0) return { bySource: new Map(), translated: 0, cached: 0 };

  const cached = await lookupTranslations(opts.docId, opts.targetLang, wanted);
  const missing = wanted.filter((p) => !cached.has(p));
  if (missing.length === 0) return { bySource: cached, translated: 0, cached: cached.size };

  const fresh = await translateUncached(opts.provider, missing, opts.targetLang, opts.onUsage);
  await saveTranslations(
    opts.docId,
    opts.targetLang,
    [...fresh].map(([source, text]) => ({ source, text })),
  );
  const bySource = new Map(cached);
  for (const [source, text] of fresh) bySource.set(source, text);
  return { bySource, translated: fresh.size, cached: cached.size };
}
