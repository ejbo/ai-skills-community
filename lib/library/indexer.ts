// One-time AI reading of a 知识库 document: per-chapter index summaries
// (checkpointed on each LibraryChapter row) followed by the whole-doc 导读
// overview. Called fire-and-forget after ingest and from the /index route —
// it NEVER throws; every failure lands on the row (aiIndexState + aiError)
// and a rerun resumes from the last checkpoint (chapters with aiSummary null).

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getProvider, LLMConfigError, type LLMProvider } from '@/lib/llm';
import {
  chapterSummaryPrompt,
  overviewPrompt,
  parseChapterSummary,
  parseOverview,
  sampleChapterText,
} from './ai-prompts';

const STALE_LOCK_MS = 10 * 60 * 1000;
const CHAPTER_SAMPLE_TOKENS = 12_000;
// Cost ceiling: one LLM call per chapter — a pathological 2000-chapter EPUB
// must not turn into 2000 calls. Chapters beyond the cap stay unindexed (the
// retrieval index lines are capped at 80 chapters anyway).
const MAX_INDEX_CHAPTERS = 120;

export async function runDocIndexing(docId: string, opts?: { force?: boolean }): Promise<void> {
  const usage = { input: 0, output: 0 };
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
        docTypePinned: true,
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

    let provider: LLMProvider;
    try {
      provider = getProvider();
    } catch (e) {
      await fail(e instanceof LLMConfigError ? e.message : (e as Error).message);
      return;
    }

    const chapters = await prisma.libraryChapter.findMany({
      where: { docId },
      orderBy: { chapterIndex: 'asc' },
      select: { id: true, chapterIndex: true, title: true, charCount: true, aiSummary: true },
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
      let text: string;
      try {
        const out = await provider.complete({
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          maxTokens: prompt.maxTokens,
        });
        text = out.text;
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
      const parsed = parseChapterSummary(text);
      await prisma.libraryChapter.update({
        where: { id: chapter.id },
        data: { aiSummary: parsed?.summary ?? '', aiKeywords: parsed?.keywords ?? [] },
      });
      chapter.aiSummary = parsed?.summary ?? '';
    }

    const chapterSummaries = chapters
      .filter((c) => c.aiSummary)
      .map((c) => `${c.title ? `《${c.title}》：` : ''}${c.aiSummary}`);
    if (chapterSummaries.length === 0) {
      await fail('章节摘要解析失败');
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
    let text: string;
    try {
      const out = await provider.complete({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: prompt.maxTokens,
      });
      text = out.text;
      if (out.usage) {
        usage.input += out.usage.input;
        usage.output += out.usage.output;
      }
    } catch (e) {
      await fail((e as Error).message);
      return;
    }

    const parsed = parseOverview(text);
    if (!parsed) {
      await fail('解析失败');
      return;
    }

    const { docType, ...overview } = parsed;
    await prisma.libraryDoc.update({
      where: { id: docId },
      data: {
        aiOverview: overview,
        ...(doc.summary === '' ? { summary: overview.summary } : {}),
        ...(!doc.docTypePinned && docType ? { docType } : {}),
        aiModel: env.LLM_MODEL ?? 'default',
        aiIndexedAt: new Date(),
        aiSourceHash: doc.contentHash,
        aiIndexState: 'ready',
        aiError: null,
        aiTokensInput: { increment: usage.input },
        aiTokensOutput: { increment: usage.output },
      },
    });
  } catch (e) {
    console.error('[library] runDocIndexing failed', e);
    await fail((e as Error)?.message ?? '未知错误');
  }
}
