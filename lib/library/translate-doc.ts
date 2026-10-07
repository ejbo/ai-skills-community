// Whole-document 译文 pass — one target language per run.
//
// Walks the chapters, translates their leaf blocks through the SHARED cache
// (lib/library/translation.ts) and stores each rebuilt chapter as a
// LibraryChapterTranslation row. Because it fills the same cache rows that
// on-demand selection translation reads, a fully translated doc makes every
// later 翻译 click instant — and passages readers already translated by hand
// cost nothing here.
//
// WHEN it runs (owner, 2026-10-07: 正文自动翻译):
//  - after indexing, for every target language, when the doc is small enough
//    (AUTO_TRANSLATE_MAX_CHARS — web articles are ready before anyone opens
//    them). The TITLE is translated regardless of size: it is one passage, and
//    cards/lists show it.
//  - when a reader opens the doc in a language it has no translation for — the
//    reader starts it automatically (no button), beginning at the chapter being
//    read and wrapping around, so the page in front of them lands first.
//
// Never throws: like the indexer, every failure lands on the row.

import { prisma } from '@/lib/db';
import { LLMConfigError, type LLMProvider } from '@/lib/llm';
import { getLibraryProvider } from './llm';
import { applyBlockTranslations, htmlBlockTexts } from './sanitize';
import { normalizeSource, translateWithCache } from './translation';
import { asTitleTranslations, targetLangsFor, type TargetLang } from './translation-shared';
import { chapterSourceHash, passOrder, STALE_LOCK_MS } from './translation-state';

export { STALE_LOCK_MS } from './translation-state';

/**
 * Characters of source text a doc may spend on an AUTOMATIC pass at ingest.
 * Web articles and blog posts (the common case) land well under it; a book is
 * translated when its first reader opens it in another language. Reader- and
 * button-started passes ignore this cap.
 */
export const AUTO_TRANSLATE_MAX_CHARS = Number(process.env.LIBRARY_AUTO_TRANSLATE_MAX_CHARS ?? 40_000);

/** Chapters in a row whose model calls ALL failed before the pass gives up (the rest stay pending). */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface TranslateDocOptions {
  /** Reader / button trigger: ignore the auto-translate size cap. */
  force?: boolean;
  /** Translate this chapter first, then the ones after it, then wrap around. */
  startChapter?: number;
}

type DocRow = { id: string; title: string; language: string | null; status: string; deletedAt: Date | null };

async function loadDoc(docId: string): Promise<DocRow | null> {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id: docId },
    select: { id: true, title: true, language: true, status: true, deletedAt: true },
  });
  return doc && !doc.deletedAt && doc.status === 'ready' ? doc : null;
}

/**
 * Translate the title into `lang` and merge it into `titleTranslations`
 * ATOMICALLY (two language passes may finish at the same moment). The write is
 * conditioned on the title still being the one that was translated, and a
 * stored set for an OLDER title is replaced rather than merged into.
 */
async function translateTitle(doc: DocRow, lang: TargetLang, provider: LLMProvider): Promise<void> {
  const title = doc.title.trim();
  if (!title) return;
  const existing = asTitleTranslations(
    (await prisma.libraryDoc.findUnique({ where: { id: doc.id }, select: { titleTranslations: true } }))
      ?.titleTranslations,
  );
  if (existing?.source === doc.title && existing[lang]) return;

  const { bySource } = await translateWithCache({ docId: doc.id, targetLang: lang, passages: [title], provider });
  const text = bySource.get(normalizeSource(title))?.trim();
  if (!text) return;
  await prisma.$executeRaw`
    UPDATE "LibraryDoc"
    SET "titleTranslations" =
      (CASE WHEN "titleTranslations"->>'source' = ${doc.title}
            THEN "titleTranslations"
            ELSE jsonb_build_object('source', ${doc.title}::text) END)
      || jsonb_build_object(${lang}::text, ${text}::text)
    WHERE "id" = ${doc.id} AND "title" = ${doc.title}`;
}

/**
 * Claim the (doc, lang) pass. A guarded write, so two triggers can never both
 * run: create the row, or flip a non-running / stale-running one to running.
 */
async function claim(docId: string, lang: TargetLang): Promise<boolean> {
  const now = new Date();
  // skipDuplicates: an existing row is the normal case, not an error worth a log line.
  const created = await prisma.libraryDocTranslation.createMany({
    data: [{ docId, targetLang: lang, state: 'running', heartbeatAt: now }],
    skipDuplicates: true,
  });
  if (created.count > 0) return true;
  const res = await prisma.libraryDocTranslation.updateMany({
    where: {
      docId,
      targetLang: lang,
      OR: [{ state: { not: 'running' } }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }],
    },
    data: { state: 'running', error: null, heartbeatAt: now, finishedAt: null },
  });
  return res.count > 0;
}

async function finish(docId: string, lang: TargetLang, state: 'ready' | 'partial' | 'failed', error: string | null) {
  await prisma.libraryDocTranslation
    .update({
      where: { docId_targetLang: { docId, targetLang: lang } },
      data: { state, error: error?.slice(0, 500) ?? null, finishedAt: new Date(), heartbeatAt: new Date() },
    })
    .catch(() => {});
}

/**
 * Run (or resume) the `lang` pass. Chapters that already have a FRESH
 * translation are skipped, so re-running after an edit or a crash only pays for
 * what changed.
 */
export async function runDocTranslation(
  docId: string,
  lang: TargetLang,
  opts: TranslateDocOptions = {},
): Promise<void> {
  const usage = { input: 0, output: 0 };
  const onUsage = (i: number, o: number) => {
    usage.input += i;
    usage.output += o;
  };
  let claimed = false;

  try {
    const doc = await loadDoc(docId);
    if (!doc || !targetLangsFor(doc.language).includes(lang)) return;

    const chapters = await prisma.libraryChapter.findMany({
      where: { docId },
      orderBy: { chapterIndex: 'asc' },
      select: {
        id: true,
        chapterIndex: true,
        title: true,
        html: true,
        charCount: true,
        translations: { where: { targetLang: lang }, select: { sourceHash: true } },
      },
    });
    if (chapters.length === 0) return;

    const pending = chapters.filter((c) => {
      const row = c.translations[0];
      // Legacy rows count as pending HERE (rebuilt from cache, ~free) but as fresh for display.
      return !row || row.sourceHash !== chapterSourceHash(c.html);
    });

    const totalChars = chapters.reduce((n, c) => n + c.charCount, 0);
    const tooBigForAuto = !opts.force && totalChars > AUTO_TRANSLATE_MAX_CHARS;

    let provider: LLMProvider;
    try {
      provider = (await getLibraryProvider()).provider;
    } catch (e) {
      if (tooBigForAuto) return; // an unasked pass never records a failure nobody asked for
      if (await claim(docId, lang)) {
        claimed = true;
        await finish(docId, lang, 'failed', e instanceof LLMConfigError ? e.message : (e as Error).message);
      }
      return;
    }

    // The title is one passage and shows on every card — translate it even when
    // the body waits for a reader.
    if (tooBigForAuto) {
      await translateTitle(doc, lang, provider).catch((e) =>
        console.error('[library] title translation failed', (e as Error)?.message),
      );
      return;
    }

    if (!(await claim(docId, lang))) return;
    claimed = true;

    await translateTitle(doc, lang, provider).catch((e) =>
      console.error('[library] title translation failed', (e as Error)?.message),
    );

    let incomplete = 0;
    let lastError: string | null = null;
    // A dead provider would otherwise time out once per chapter of a whole book.
    let consecutiveFailures = 0;
    for (const chapter of passOrder(pending, opts.startChapter)) {
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        incomplete += 1;
        continue;
      }
      const blocks = htmlBlockTexts(chapter.html);
      const titleSource = chapter.title?.trim() || null;
      try {
        let bySource = new Map<string, string>();
        const passages = titleSource ? [titleSource, ...blocks] : blocks;
        if (passages.length > 0) {
          ({ bySource } = await translateWithCache({ docId, targetLang: lang, passages, provider, onUsage }));
        }
        const covered = blocks.filter((b) => !normalizeSource(b) || bySource.has(normalizeSource(b))).length;
        // Partial coverage still renders: untranslated blocks keep the original.
        // A chapter where NOTHING landed gets no row, so the next pass retries it.
        if (blocks.length === 0 || covered > 0) {
          const html = blocks.length === 0 ? chapter.html : applyBlockTranslations(chapter.html, bySource);
          const title = titleSource ? (bySource.get(normalizeSource(titleSource)) ?? null) : null;
          const sourceHash = chapterSourceHash(chapter.html);
          await prisma.libraryChapterTranslation.upsert({
            where: { chapterId_targetLang: { chapterId: chapter.id, targetLang: lang } },
            create: { chapterId: chapter.id, targetLang: lang, html, title, sourceHash },
            update: { html, title, sourceHash },
          });
        }
        if (covered < blocks.length) incomplete += 1;
        consecutiveFailures = 0;
      } catch (e) {
        incomplete += 1;
        consecutiveFailures += 1;
        lastError = (e as Error)?.message ?? 'unknown';
        console.error('[library] chapter translation failed', chapter.chapterIndex, lastError);
      }
      // Heartbeat: a live pass is never mistaken for a crashed one.
      await prisma.libraryDocTranslation
        .update({ where: { docId_targetLang: { docId, targetLang: lang } }, data: { heartbeatAt: new Date() } })
        .catch(() => {});
    }

    if (incomplete === 0) {
      await finish(docId, lang, 'ready', null);
    } else if (incomplete === pending.length && lastError) {
      await finish(docId, lang, 'failed', lastError);
    } else {
      await finish(docId, lang, 'partial', `部分章节未完整翻译：${incomplete}/${chapters.length}`);
    }
  } catch (e) {
    console.error('[library] runDocTranslation failed', e);
    if (claimed) await finish(docId, lang, 'failed', (e as Error)?.message ?? '未知错误');
  } finally {
    if (usage.input || usage.output) {
      await prisma.libraryDoc
        .update({
          where: { id: docId },
          data: { aiTokensInput: { increment: usage.input }, aiTokensOutput: { increment: usage.output } },
        })
        .catch(() => {});
    }
  }
}

/** Every target language, one after the other (ingest / re-index). */
export async function runDocTranslations(docId: string, opts: TranslateDocOptions = {}): Promise<void> {
  const doc = await prisma.libraryDoc
    .findUnique({ where: { id: docId }, select: { language: true } })
    .catch(() => null);
  if (!doc) return;
  for (const lang of targetLangsFor(doc.language)) {
    await runDocTranslation(docId, lang, opts);
  }
}
