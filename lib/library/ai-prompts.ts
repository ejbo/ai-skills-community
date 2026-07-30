// Pure prompt/parse helpers for the 知识库 AI indexing + retrieval pipeline.
// No DB / env / LLM imports — mirrors lib/video/ai.ts: the indexer and the
// chat route do the IO, this file only assembles prompts and parses replies
// so everything stays unit-testable and the cacheable prefixes byte-stable.

import { extractJsonObject } from '@/lib/skill-assist';
import { estimateTokens } from './chunker';
import {
  LIBRARY_CATEGORIES,
  cleanCategories,
  isDocType,
  type AiOverview,
  type LibraryDocTypeValue,
} from './types';

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asStrList(v: unknown, cap: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, cap)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen) : s));
}

/**
 * Clamp a chapter's text to a token budget: keep the head (~2/3 of budget) and
 * the tail (~1/4), replacing the middle with an ellipsis marker. Deterministic,
 * so reruns produce the same prompt.
 */
export function sampleChapterText(text: string, maxTokens: number): string {
  const total = estimateTokens(text);
  if (total <= maxTokens) return text;
  const ratio = maxTokens / total;
  const headChars = Math.max(1, Math.floor(text.length * ratio * (2 / 3)));
  const tailChars = Math.max(1, Math.floor(text.length * ratio * (1 / 4)));
  const head = text.slice(0, headChars).trimEnd();
  const tail = text.slice(text.length - tailChars).trimStart();
  return `${head}\n\n……（中间部分略）\n\n${tail}`;
}

export function chapterSummaryPrompt(input: {
  docTitle: string;
  chapterTitle: string | null;
  chapterText: string;
}): { system: string; user: string; maxTokens: number } {
  return {
    system:
      '你是知识库的索引编辑，负责为文档的每个章节生成检索索引条目。' +
      '只输出一个 JSON 对象，格式：{"summary":"不超过120字的章节概要","keywords":["最多6个正文中原样出现的关键词"]}，' +
      '不要输出任何其他内容。',
    user: [
      `文档标题：《${input.docTitle}》`,
      `章节标题：${input.chapterTitle ?? '（无）'}`,
      '',
      '章节正文：',
      input.chapterText,
    ].join('\n'),
    maxTokens: 300,
  };
}

export function overviewPrompt(input: {
  title: string;
  author: string | null;
  tocLine: string;
  chapterSummaries: string[];
}): { system: string; user: string; maxTokens: number } {
  const numbered = input.chapterSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const catTable = LIBRARY_CATEGORIES.map((c) => `${c.slug}（${c.name}）`).join('、');
  return {
    system:
      '你是知识库的导读编辑。根据整篇文档的章节摘要，为读者撰写 AI 导读，并判断文档类型与主题分类。' +
      '只输出一个 JSON 对象，格式：{"summary":"不超过200字的整体概述","outline":["3-10条内容脉络"],' +
      '"keyPoints":["3-8条核心要点"],"questions":["3-5个值得向本文档提出的问题"],' +
      '"docType":"book|paper|blog|article|report|other",' +
      '"categories":["1-3个主题分类 slug"]}，不要输出任何其他内容。' +
      `categories 只能从固定表中选：${catTable}；没有合适的就返回空数组。`,
    user: [
      `文档标题：《${input.title}》`,
      `作者：${input.author ?? '未知'}`,
      `目录：${input.tocLine || '（无）'}`,
      '',
      '各章节摘要：',
      numbered || '（无）',
    ].join('\n'),
    maxTokens: 1200,
  };
}

export function retrievePrompt(input: {
  question: string;
  history: { role: string; content: string }[];
  indexLines: string[];
}): { system: string; user: string; maxTokens: number } {
  const history = input.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 300)}`)
    .join('\n');
  return {
    system:
      '你是文档问答的检索规划器。根据章节索引和用户问题，判断答案最可能出现的章节，' +
      '并给出用于在原文中做字面检索的词语。只输出一个 JSON 对象，格式：' +
      '{"chapters":[最相关章节的序号（从1开始，最多4个）],"terms":["最多5个可能在原文中原样出现的检索词"]}，' +
      '不要输出任何其他内容。',
    user: [
      '章节索引：',
      input.indexLines.join('\n') || '（无）',
      '',
      ...(history ? ['最近对话：', history, ''] : []),
      `用户问题：${input.question}`,
    ].join('\n'),
    maxTokens: 300,
  };
}

export function answerSystem(input: {
  docTitle: string;
  excerpts: { key: string; text: string }[];
  language: 'zh' | 'en' | null;
}): string {
  const lang = input.language === 'zh' ? '中文' : input.language === 'en' ? '英文' : null;
  const blocks = input.excerpts.map((e) => `[${e.key}]\n${e.text}`).join('\n\n');
  return [
    `你是「知识库」的文档问答助手，正在回答关于文档《${input.docTitle}》的问题。`,
    ...(lang ? [`该文档主要为${lang}内容。`] : []),
    '',
    '以下是从文档中检索到的原文片段，每段以其引用键开头：',
    '',
    blocks,
    '',
    '回答规则：',
    '- 仅依据上述片段回答问题；在每个论断之后紧跟支持它的引用标记，如 [c0-2]。引用标记只能使用上面出现过的键，不得编造。',
    '- 片段中没有的内容，先说明「文中未找到」；如需依据通用知识补充，必须清楚标注「文档之外」。',
    '- 用提问者所用的语言回答。',
    '- 使用 Markdown 排版，简洁准确。',
  ].join('\n');
}

export function parseChapterSummary(text: string): { summary: string; keywords: string[] } | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const summary = asStr(obj.summary);
  if (!summary) return null;
  return {
    summary: summary.length > 160 ? summary.slice(0, 160) : summary,
    keywords: asStrList(obj.keywords, 6, 40),
  };
}

export function parseOverview(
  text: string,
): (AiOverview & { docType: LibraryDocTypeValue | null; categories: string[] }) | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const summary = asStr(obj.summary);
  if (!summary) return null;
  return {
    summary: summary.length > 400 ? summary.slice(0, 400) : summary,
    outline: asStrList(obj.outline, 12, 200),
    keyPoints: asStrList(obj.keyPoints, 10, 300),
    questions: asStrList(obj.questions, 6, 200),
    docType: isDocType(obj.docType) ? obj.docType : null,
    categories: cleanCategories(obj.categories),
  };
}

/** Tolerant: any parse failure degrades to an empty plan (caller falls back). */
export function parseRetrieve(text: string): { chapters: number[]; terms: string[] } {
  const obj = extractJsonObject(text);
  if (!obj) return { chapters: [], terms: [] };
  const chapters = Array.isArray(obj.chapters)
    ? [...new Set(obj.chapters.map(Number).filter((n) => Number.isInteger(n) && n >= 1))].slice(0, 4)
    : [];
  return { chapters, terms: asStrList(obj.terms, 5, 60) };
}
