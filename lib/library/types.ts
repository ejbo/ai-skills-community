// 知识库 shared types + text heuristics. Pure module — no DB / env imports so
// extraction, chunking and tests can use it freely.

export type LibraryDocTypeValue = 'book' | 'paper' | 'blog' | 'article' | 'report' | 'other';

export const DOC_TYPE_LABELS: Record<LibraryDocTypeValue, string> = {
  book: '书籍',
  paper: '论文',
  blog: '博客',
  article: '文章',
  report: '报告',
  other: '其他',
};

export const DOC_TYPES: LibraryDocTypeValue[] = ['book', 'paper', 'blog', 'article', 'report', 'other'];

export function isDocType(v: unknown): v is LibraryDocTypeValue {
  return typeof v === 'string' && (DOC_TYPES as string[]).includes(v);
}

/** One extracted chapter: sanitized reading HTML + plain text (paragraphs joined by '\n\n'). */
export interface ExtractedChapter {
  title: string | null;
  html: string;
  text: string;
}

export interface ExtractedDoc {
  title: string;
  author: string | null;
  language: string | null; // 'zh' | 'en' | null
  siteName: string | null;
  publishedAt: Date | null;
  /** og:image etc. — ingest downloads it best-effort. */
  coverRemoteUrl: string | null;
  /** EPUB embedded cover bytes. */
  coverBuffer: { data: Buffer; ext: string } | null;
  chapters: ExtractedChapter[];
}

/** Shape of LibraryDoc.aiOverview (JSON column). */
export interface AiOverview {
  summary: string;
  outline: string[];
  keyPoints: string[];
  questions: string[];
}

// CJK ideographs + kana + hangul — each counts as one "word" for reading stats.
const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

function textCounts(text: string): { cjk: number; latin: number } {
  const cjk = (text.match(CJK_RE) ?? []).length;
  const latin = (text.replace(CJK_RE, ' ').match(LATIN_WORD_RE) ?? []).length;
  return { cjk, latin };
}

/** Word count for stats: CJK characters + latin words. */
export function countWords(text: string): number {
  const { cjk, latin } = textCounts(text);
  return cjk + latin;
}

/** ceil(cjk/400 + words/220), min 1 — ~400 字/分钟 中文, ~220 wpm English. */
export function estimateReadMinutes(cjkChars: number, latinWords: number): number {
  return Math.max(1, Math.ceil(cjkChars / 400 + latinWords / 220));
}

export function estReadMinutesForText(text: string): number {
  const { cjk, latin } = textCounts(text);
  return estimateReadMinutes(cjk, latin);
}

/** Cheap language heuristic: CJK ratio > 0.15 ⇒ 'zh'; mostly latin ⇒ 'en'; else null. */
export function detectLanguage(text: string): 'zh' | 'en' | null {
  const sample = text.slice(0, 4000);
  const solid = sample.replace(/\s/g, '');
  if (!solid) return null;
  const cjk = (solid.match(CJK_RE) ?? []).length;
  if (cjk / solid.length > 0.15) return 'zh';
  const latin = (solid.match(/[A-Za-z]/g) ?? []).length;
  if (latin / solid.length > 0.5) return 'en';
  return null;
}
