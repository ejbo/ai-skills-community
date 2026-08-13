// One-time AI reading of a 知识库 document: per-chapter index summaries
// (checkpointed on each LibraryChapter row) followed by the whole-doc 导读
// overview. Called fire-and-forget after ingest and from the /index route —
// it NEVER throws; every failure lands on the row (aiIndexState + aiError)
// and a rerun resumes from the last checkpoint (chapters with aiSummary null).

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { LLMConfigError, type LLMProvider } from '@/lib/llm';
import { explainParseFailure, type ReplyShape } from '@/lib/llm/explain';
import { getLibraryProvider } from './llm';
import {
  chapterSummaryPrompt,
  overviewPrompt,
  parseChapterSummary,
  parseOverview,
  parseTranslatedChapterSummaries,
  parseTranslatedOverview,
  sampleChapterText,
  translateChapterSummariesPrompt,
  translateOverviewPrompt,
} from './ai-prompts';
import type { AiOverview } from './types';

const STALE_LOCK_MS = 10 * 60 * 1000;
const CHAPTER_SAMPLE_TOKENS = 12_000;
// Cost ceiling: one LLM call per chapter — a pathological 2000-chapter EPUB
// must not turn into 2000 calls. Chapters beyond the cap stay unindexed (the
// retrieval index lines are capped at 80 chapters anyway).
const MAX_INDEX_CHAPTERS = 120;
// Chapter summaries are translated in batches so a 120-chapter book costs ~5
// extra calls, not 120. Small enough that one truncated reply loses little.
const TRANSLATE_BATCH = 25;

export async function runDocIndexing(docId: string, opts?: { force?: boolean }): Promise<void> {
  const usage = { input: 0, output: 0 };
  let firstBadReply: ReplyShape | null = null;
  const fail = async (message: string) => {
    await prisma.libraryDoc
      .update({
        where: { id: docId },
        data: {
          aiIndexState: 'failed',
          aiError: message.slice(0, 500),
          aiTokensInput: { increment: usage.input },
          aiTokensOutput: { increment: usage.output },
        },
      })
      .catch(() => {});
  };

  try {
    const doc = await prisma.libraryDoc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        title: true,
        author: true,
        status: true,
        deletedAt: true,
        summary: true,
        summaryEn: true,
        docTypePinned: true,
        categories: true,
        categoriesPinned: true,
        contentHash: true,
        aiIndexState: true,
        aiSourceHash: true,
        aiIndexedAt: true,
      },
    });
    if (!doc || doc.deletedAt || doc.status !== 'ready') return;
    if (doc.aiIndexState === 'ready' && doc.aiSourceHash === doc.contentHash && !opts?.force) {
      return;
    }
    if (doc.aiIndexState === 'running') {
      const stale = !doc.aiIndexedAt || Date.now() - doc.aiIndexedAt.getTime() > STALE_LOCK_MS;
      if (!opts?.force || !stale) return;
    }

    const chunkCount = await prisma.libraryChunk.count({ where: { docId } });
    if (chunkCount === 0) {
      await fail('无可分析文本');
      return;
    }

    // Claim the lock with a guarded write so two concurrent runs can't both proceed.
    const claim = await prisma.libraryDoc.updateMany({
      where: { id: docId, aiIndexState: doc.aiIndexState },
      data: { aiIndexState: 'running', aiError: null },
    });
    if (claim.count === 0) return;

    if (opts?.force) {
      // '' is the parse-failure checkpoint written below, and the resume guard
      // (`aiSummary !== null`) treats it as done forever. Without this reset an
      // admin who fixes the model and clicks 重新索引 sees nothing change.
      // Genuinely empty chapters are re-skipped cheaply via charCount === 0.
      await prisma.libraryChapter.updateMany({
        where: { docId, aiSummary: '' },
        data: { aiSummary: null, aiSummaryEn: null, aiKeywords: [] },
      });
    }

    let provider: LLMProvider;
    let overrideModel: string | null = null;
    try {
      const resolved = await getLibraryProvider();
      provider = resolved.provider;
      overrideModel = resolved.model;
    } catch (e) {
      await fail(e instanceof LLMConfigError ? e.message : (e as Error).message);
      return;
    }

    const chapters = await prisma.libraryChapter.findMany({
      where: { docId },
      orderBy: { chapterIndex: 'asc' },
      select: {
        id: true,
        chapterIndex: true,
        title: true,
        charCount: true,
        aiSummary: true,
        aiSummaryEn: true,
      },
    });

    for (const chapter of chapters.slice(0, MAX_INDEX_CHAPTERS)) {
      if (chapter.aiSummary !== null || chapter.charCount === 0) continue;
      const chunks = await prisma.libraryChunk.findMany({
        where: { docId, chapterIndex: chapter.chapterIndex },
        orderBy: { ordinal: 'asc' },
        select: { text: true },
      });
      const chapterText = chunks.map((c) => c.text).join('\n\n');
      if (!chapterText.trim()) {
        await prisma.libraryChapter.update({
          where: { id: chapter.id },
          data: { aiSummary: '', aiKeywords: [] },
        });
        chapter.aiSummary = '';
        continue;
      }

      const prompt = chapterSummaryPrompt({
        docTitle: doc.title,
        chapterTitle: chapter.title,
        chapterText: sampleChapterText(chapterText, CHAPTER_SAMPLE_TOKENS),
      });
      let reply: ReplyShape;
      try {
        const out = await provider.complete({
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          maxTokens: prompt.maxTokens,
          json: true,
        });
        reply = out;
        if (out.usage) {
          usage.input += out.usage.input;
          usage.output += out.usage.output;
        }
      } catch (e) {
        // Save nothing for this chapter — the null aiSummary checkpoint makes
        // the next run resume exactly here.
        await fail((e as Error).message);
        return;
      }
      // Empty-string placeholder on parse failure so reruns don't loop on it.
      const parsed = parseChapterSummary(reply.text);
      // Keep the first unparseable reply: if EVERY chapter fails we'd otherwise
      // report a bare "章节摘要解析失败" with no way to tell whether the model
      // ignored the JSON instruction or ran out of tokens mid-<think>.
      if (!parsed && firstBadReply === null) firstBadReply = reply;
      await prisma.libraryChapter.update({
        where: { id: chapter.id },
        data: {
          aiSummary: parsed?.summary ?? '',
          // A regenerated 中文 summary invalidates its English twin.
          aiSummaryEn: null,
          aiKeywords: parsed?.keywords ?? [],
        },
      });
      chapter.aiSummary = parsed?.summary ?? '';
      chapter.aiSummaryEn = null;
    }

    const chapterSummaries = chapters
      .filter((c) => c.aiSummary)
      .map((c) => `${c.title ? `《${c.title}》：` : ''}${c.aiSummary}`);
    // A doc where 119/120 chapters failed to parse used to be written as fully
    // `ready` with aiError: null — indistinguishable from a clean run.
    const indexable = chapters.slice(0, MAX_INDEX_CHAPTERS).filter((c) => c.charCount > 0);
    const missing = indexable.length - chapterSummaries.length;
    const partialWarning =
      indexable.length > 0 && missing / indexable.length > 0.3
        ? `部分章节未能解析：${missing}/${indexable.length} 章缺少摘要` +
          (firstBadReply ? `。${explainParseFailure('示例', firstBadReply)}` : '')
        : null;
    if (chapterSummaries.length === 0) {
      await fail(
        firstBadReply
          ? explainParseFailure('章节摘要解析失败', firstBadReply)
          : '章节摘要解析失败：没有可用的章节内容',
      );
      return;
    }
    const tocLine = chapters
      .map((c) => c.title?.trim())
      .filter((t): t is string => Boolean(t))
      .slice(0, 30)
      .join(' / ');

    const prompt = overviewPrompt({
      title: doc.title,
      author: doc.author,
      tocLine,
      chapterSummaries,
    });
    let reply: ReplyShape;
    try {
      const out = await provider.complete({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: prompt.maxTokens,
          json: true,
      });
      reply = out;
      if (out.usage) {
        usage.input += out.usage.input;
        usage.output += out.usage.output;
      }
    } catch (e) {
      await fail((e as Error).message);
      return;
    }

    const parsed = parseOverview(reply.text);
    if (!parsed) {
      await fail(explainParseFailure('AI 导读解析失败', reply));
      return;
    }

    const { docType, categories, ...overview } = parsed;

    // Commit the 中文 result FIRST. The English pass below is several more LLM
    // calls; running it before this write meant a process death (deploy,
    // systemd restart) mid-translation discarded a finished 中文 导读 AND left
    // aiIndexState stuck on 'running', which every non-force rerun then honours.
    // `aiOverviewEn: DbNull` invalidates any previous translation up front — a
    // failed pass must not leave an English 导读 describing the OLD content.
    await prisma.libraryDoc.update({
      where: { id: docId },
      data: {
        aiOverview: overview,
        aiOverviewEn: Prisma.DbNull,
        ...(doc.summary === '' ? { summary: overview.summary } : {}),
        ...(!doc.docTypePinned && docType ? { docType } : {}),
        ...(!doc.categoriesPinned && doc.categories.length === 0 && categories.length > 0
          ? { categories }
          : {}),
        aiModel: overrideModel ?? env.LLM_MODEL ?? 'default',
        aiIndexedAt: new Date(),
        aiSourceHash: doc.contentHash,
        aiIndexState: 'ready',
        // Non-null on a partial success so /manage/library can badge it rather
        // than reporting a half-indexed doc as healthy.
        aiError: partialWarning,
        aiTokensInput: { increment: usage.input },
        aiTokensOutput: { increment: usage.output },
      },
    });
    usage.input = 0; // committed — the pass below accounts for its own tokens
    usage.output = 0;

    // ── English twin (best-effort) ────────────────────────────────────────
    // 中文 is the source of truth; a failed translation must never fail the
    // index run — the reader just falls back to 中文 (lib/library/i18n-content).
    const overviewEn = await translateOverview(provider, doc.title, overview, usage);
    await translateChapterSummaries(
      provider,
      chapters.filter((c) => c.aiSummary && !c.aiSummaryEn),
      usage,
    );
    await prisma.libraryDoc
      .update({
        where: { id: docId },
        data: {
          ...(overviewEn ? { aiOverviewEn: overviewEn } : {}),
          // Gate on the ENGLISH column's own emptiness. Gating on `summary`
          // instead let an empty 中文 blurb authorize overwriting an English one
          // the uploader had typed in the edit page's English tab.
          ...(overviewEn && doc.summaryEn === '' ? { summaryEn: overviewEn.summary } : {}),
          aiTokensInput: { increment: usage.input },
          aiTokensOutput: { increment: usage.output },
        },
      })
      .catch(() => {});
  } catch (e) {
    console.error('[library] runDocIndexing failed', e);
    await fail((e as Error)?.message ?? '未知错误');
  }
}

type Usage = { input: number; output: number };

function addUsage(usage: Usage, out: { usage: { input: number; output: number } | null }): void {
  if (out.usage) {
    usage.input += out.usage.input;
    usage.output += out.usage.output;
  }
}

/**
 * English twin of the 中文 导读. Returns null on ANY failure (LLM error, an
 * unparseable reply, a reasoning model that never emitted JSON) — the caller
 * simply stores no English version and the reader falls back to 中文.
 */
async function translateOverview(
  provider: LLMProvider,
  title: string,
  overview: AiOverview,
  usage: Usage,
): Promise<AiOverview | null> {
  try {
    const prompt = translateOverviewPrompt({ title, overview });
    const out = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: prompt.maxTokens,
      json: true,
    });
    addUsage(usage, out);
    return parseTranslatedOverview(out.text);
  } catch (e) {
    console.error('[library] overview translation failed', (e as Error)?.message);
    return null;
  }
}

/**
 * Fill `aiSummaryEn` for chapters that have a 中文 summary but no English one.
 * Batched, best-effort, and idempotent: a chapter the model skipped simply
 * stays null and the 目录 renders its 中文 summary.
 */
async function translateChapterSummaries(
  provider: LLMProvider,
  chapters: { id: string; chapterIndex: number; title: string | null; aiSummary: string | null }[],
  usage: Usage,
): Promise<void> {
  const items = chapters
    .filter((c) => c.aiSummary)
    .map((c) => ({ id: c.id, chapterIndex: c.chapterIndex, title: c.title, summary: c.aiSummary! }));
  for (let i = 0; i < items.length; i += TRANSLATE_BATCH) {
    const batch = items.slice(i, i + TRANSLATE_BATCH);
    try {
      const prompt = translateChapterSummariesPrompt({ items: batch });
      const out = await provider.complete({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: prompt.maxTokens,
        json: true,
      });
      addUsage(usage, out);
      const byIndex = parseTranslatedChapterSummaries(out.text);
      await Promise.all(
        batch.map(async (it) => {
          const en = byIndex.get(it.chapterIndex);
          if (!en) return;
          await prisma.libraryChapter
            .update({ where: { id: it.id }, data: { aiSummaryEn: en } })
            .catch(() => {});
        }),
      );
    } catch (e) {
      console.error('[library] chapter summary translation failed', (e as Error)?.message);
      return; // a broken model won't get better on the next batch
    }
  }
}
