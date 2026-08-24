// Whole-document 译文 pass.
//
// Walks every chapter, translates its leaf blocks through the SHARED cache
// (lib/library/translation.ts) and stores the rebuilt chapter on
// `LibraryChapter.translatedHtml`. Because it fills the same cache rows that
// on-demand selection translation reads, a document that has been fully
// translated makes every later 翻译 click instant — and a doc where readers
// translated passages by hand starts this pass with those already done.
//
// Never throws: like the indexer, every failure lands on the row.

import { prisma } from '@/lib/db';
import { LLMConfigError, type LLMProvider } from '@/lib/llm';
import { getLibraryProvider } from './llm';
import { applyBlockTranslations, htmlBlockTexts } from './sanitize';
import { normalizeSource, targetLangFor, translateWithCache, type TargetLang } from './translation';

const STALE_LOCK_MS = 15 * 60 * 1000;

/**
 * Characters of source text a doc may spend on an AUTOMATIC pass at ingest.
 * Web articles and blog posts (the common case) land well under it and are
 * translated before anyone opens them; a book stays untranslated until a reader
 * asks, which is the policy the product owner chose. A manual trigger ignores
 * this cap.
 */
export const AUTO_TRANSLATE_MAX_CHARS = Number(process.env.LIBRARY_AUTO_TRANSLATE_MAX_CHARS ?? 40_000);

export interface TranslateDocOptions {
  /** Manual trigger: ignore the auto-translate size cap. */
  force?: boolean;
}

export async function runDocTranslation(docId: string, opts?: TranslateDocOptions): Promise<void> {
  const usage = { input: 0, output: 0 };
  const fail = async (message: string) => {
    await prisma.libraryDoc
      .update({
        where: { id: docId },
        data: { translationState: 'failed', translationError: message.slice(0, 500) },
      })
      .catch(() => {});
  };

  try {
    const doc = await prisma.libraryDoc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        language: true,
        status: true,
        deletedAt: true,
        wordCount: true,
        translationState: true,
        translatedAt: true,
      },
    });
    if (!doc || doc.deletedAt || doc.status !== 'ready') return;
    if (doc.translationState === 'ready' && !opts?.force) return;
    if (doc.translationState === 'running') {
      const stale = !doc.translatedAt || Date.now() - doc.translatedAt.getTime() > STALE_LOCK_MS;
      if (!opts?.force || !stale) return;
    }

    const chapters = await prisma.libraryChapter.findMany({
      where: { docId },
      orderBy: { chapterIndex: 'asc' },
      select: { id: true, chapterIndex: true, html: true, charCount: true },
    });
    if (chapters.length === 0) return;

    const totalChars = chapters.reduce((n, c) => n + c.charCount, 0);
    if (!opts?.force && totalChars > AUTO_TRANSLATE_MAX_CHARS) {
      // Too big to translate unasked — leave it for a reader to trigger.
      return;
    }

    // Guarded claim so two triggers cannot both run.
    const claim = await prisma.libraryDoc.updateMany({
      where: { id: docId, translationState: doc.translationState },
      data: { translationState: 'running', translationError: null, translatedAt: new Date() },
    });
    if (claim.count === 0) return;

    const targetLang: TargetLang = targetLangFor(doc.language);

    let provider: LLMProvider;
    try {
      provider = (await getLibraryProvider()).provider;
    } catch (e) {
      await fail(e instanceof LLMConfigError ? e.message : (e as Error).message);
      return;
    }

    let done = 0;
    for (const chapter of chapters) {
      const blocks = htmlBlockTexts(chapter.html);
      if (blocks.length === 0) {
        done += 1;
        continue;
      }
      try {
        const { bySource } = await translateWithCache({
          docId,
          targetLang,
          passages: blocks,
          provider,
          onUsage: (i, o) => {
            usage.input += i;
            usage.output += o;
          },
        });
        // Partial coverage still renders: untranslated blocks keep the original.
        const covered = blocks.filter((b) => bySource.has(normalizeSource(b))).length;
        if (covered > 0) {
          await prisma.libraryChapter.update({
            where: { id: chapter.id },
            data: { translatedHtml: applyBlockTranslations(chapter.html, bySource) },
          });
        }
        if (covered === blocks.length) done += 1;
      } catch (e) {
        console.error('[library] chapter translation failed', chapter.chapterIndex, (e as Error)?.message);
        // Keep whatever landed; report a partial pass below.
      }
    }

    await prisma.libraryDoc.update({
      where: { id: docId },
      data: {
        translationLang: targetLang,
        translationState: done === chapters.length ? 'ready' : 'partial',
        translationError:
          done === chapters.length ? null : `部分章节未翻译：${chapters.length - done}/${chapters.length}`,
        translatedAt: new Date(),
        aiTokensInput: { increment: usage.input },
        aiTokensOutput: { increment: usage.output },
      },
    });
  } catch (e) {
    console.error('[library] runDocTranslation failed', e);
    await fail((e as Error)?.message ?? '未知错误');
  }
}
