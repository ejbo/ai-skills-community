// Two-stage retrieval for 知识库 chat. Stage ①: a cheap LLM planning call over
// the per-chapter index (aiSummary + keywords) picks candidate chapters and
// literal search terms. Stage ②: term hits plus those chapters' chunks are
// packed into a token budget and become the citable excerpts of the answer
// system prompt. The chat route streams the actual answer.

import { prisma } from '@/lib/db';
import { type LLMProvider } from '@/lib/llm';
import { getLibraryProvider } from './llm';
import { answerSystem, parseRetrieve, retrievePrompt } from './ai-prompts';

const CONTEXT_BUDGET_TOKENS = 10_000;
const INDEX_LINES_CAP = 80;
const TERM_HITS_TAKE = 3;
const FALLBACK_CHUNKS = 6;

export interface ChatExcerpt {
  key: string;
  text: string;
  chapterIndex: number;
  charStart: number;
}

const CHUNK_SELECT = {
  chapterIndex: true,
  ordinal: true,
  text: true,
  tokenEstimate: true,
  charStart: true,
} as const;

interface ChunkRow {
  chapterIndex: number;
  ordinal: number;
  text: string;
  tokenEstimate: number;
  charStart: number;
}

export async function buildChatContext(
  docId: string,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<
  | { ok: true; system: string; excerpts: ChatExcerpt[] }
  | { ok: false; error: 'not_indexed' | 'no_content' | 'llm_error' }
> {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id: docId },
    select: { id: true, title: true, language: true, aiIndexState: true },
  });
  if (!doc || doc.aiIndexState !== 'ready') return { ok: false, error: 'not_indexed' };

  const chunkCount = await prisma.libraryChunk.count({ where: { docId } });
  if (chunkCount === 0) return { ok: false, error: 'no_content' };

  const chapters = await prisma.libraryChapter.findMany({
    where: { docId },
    orderBy: { chapterIndex: 'asc' },
    select: { chapterIndex: true, title: true, aiSummary: true, aiKeywords: true },
  });
  const indexLines = chapters.slice(0, INDEX_LINES_CAP).map((c) => {
    const keywords = c.aiKeywords.length > 0 ? ` ｜ ${c.aiKeywords.join('、')}` : '';
    return `第${c.chapterIndex + 1}章《${c.title ?? '未命名'}》：${c.aiSummary ?? ''}${keywords}`;
  });

  let provider: LLMProvider;
  try {
    provider = (await getLibraryProvider()).provider;
  } catch {
    return { ok: false, error: 'llm_error' };
  }

  const prompt = retrievePrompt({ question, history, indexLines });
  let planText: string;
  try {
    const out = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: prompt.maxTokens,
    });
    planText = out.text;
  } catch {
    return { ok: false, error: 'llm_error' };
  }
  const plan = parseRetrieve(planText);

  const validChapters = new Set(chapters.map((c) => c.chapterIndex));
  const selected = [...new Set(plan.chapters.map((n) => n - 1))].filter((n) =>
    validChapters.has(n),
  );

  const termHits: ChunkRow[] = [];
  for (const term of plan.terms) {
    const hits = await prisma.libraryChunk.findMany({
      where: { docId, text: { contains: term, mode: 'insensitive' } },
      orderBy: [{ chapterIndex: 'asc' }, { ordinal: 'asc' }],
      take: TERM_HITS_TAKE,
      select: CHUNK_SELECT,
    });
    termHits.push(...hits);
  }

  const chapterChunks: ChunkRow[] =
    selected.length > 0
      ? await prisma.libraryChunk.findMany({
          where: { docId, chapterIndex: { in: selected } },
          orderBy: [{ chapterIndex: 'asc' }, { ordinal: 'asc' }],
          select: CHUNK_SELECT,
        })
      : [];

  let candidates = [...termHits, ...chapterChunks];
  if (candidates.length === 0) {
    const q = question.trim();
    const questionHits = q
      ? await prisma.libraryChunk.findMany({
          where: { docId, text: { contains: q, mode: 'insensitive' } },
          orderBy: [{ chapterIndex: 'asc' }, { ordinal: 'asc' }],
          take: TERM_HITS_TAKE,
          select: CHUNK_SELECT,
        })
      : [];
    const firstChunks = await prisma.libraryChunk.findMany({
      where: { docId },
      orderBy: [{ chapterIndex: 'asc' }, { ordinal: 'asc' }],
      take: FALLBACK_CHUNKS,
      select: CHUNK_SELECT,
    });
    candidates = [...questionHits, ...firstChunks];
  }

  const seen = new Set<string>();
  const picked: ChunkRow[] = [];
  let budget = 0;
  for (const chunk of candidates) {
    const key = `c${chunk.chapterIndex}-${chunk.ordinal}`;
    if (seen.has(key)) continue;
    if (budget + chunk.tokenEstimate > CONTEXT_BUDGET_TOKENS) continue;
    seen.add(key);
    budget += chunk.tokenEstimate;
    picked.push(chunk);
  }
  picked.sort((a, b) => a.chapterIndex - b.chapterIndex || a.ordinal - b.ordinal);

  const excerpts: ChatExcerpt[] = picked.map((c) => ({
    key: `c${c.chapterIndex}-${c.ordinal}`,
    text: c.text,
    chapterIndex: c.chapterIndex,
    charStart: c.charStart,
  }));

  const system = answerSystem({
    docTitle: doc.title,
    excerpts: excerpts.map(({ key, text }) => ({ key, text })),
    language: doc.language === 'zh' || doc.language === 'en' ? doc.language : null,
  });

  return { ok: true, system, excerpts };
}
