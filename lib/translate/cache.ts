// 站内翻译 — the block cache over `ContentTranslation` (a verbatim port of the
// 知识库's lookup/save, minus `docId`, plus `fr`). Keys are hashes of the RAW unit
// text; values are RESTORED translations. Errors are swallowed on both sides: a
// cache that cannot be read is a cache miss, one that cannot be written costs the
// next reader a model call — neither may fail a request.

import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { MAX_BLOCK_CHARS, normalizeSource, type ContentLang } from './shared';

export function sourceHash(text: string): string {
  return createHash('sha256').update(normalizeSource(text)).digest('hex');
}

/** hash → translation, for the hashes that are cached. ONE query however many units. */
export async function lookupBlocks(target: ContentLang, hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(hashes)];
  if (wanted.length === 0) return out;
  try {
    const rows = await prisma.contentTranslation.findMany({
      where: { targetLang: target, sourceHash: { in: wanted } },
      select: { sourceHash: true, text: true },
    });
    for (const r of rows) out.set(r.sourceHash, r.text);
  } catch {
    /* table missing / DB blip ⇒ treat as a miss */
  }
  return out;
}

/** Persist fresh translations. Duplicates are ignored — two readers may race on the same passage. */
export async function saveBlocks(target: ContentLang, model: string, entries: { source: string; text: string }[]): Promise<void> {
  const rows = entries
    .map((e) => ({ source: normalizeSource(e.source), text: e.text }))
    .filter((e) => e.source && e.text.trim())
    .map((e) => ({
      targetLang: target,
      sourceHash: sourceHash(e.source),
      sourceText: e.source.slice(0, MAX_BLOCK_CHARS * 2),
      text: e.text,
      model,
    }));
  if (rows.length === 0) return;
  await prisma.contentTranslation.createMany({ data: rows, skipDuplicates: true }).catch(() => undefined);
}
