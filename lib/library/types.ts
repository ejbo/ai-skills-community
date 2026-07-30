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

// ── 细分类 — fixed AI-topic taxonomy (Magpie's lesson: fixed beats free tags).
// Browse-sidebar dimension; a doc can carry several. AI backfills from this
// exact list at indexing time unless the uploader picked (categoriesPinned).

export const LIBRARY_CATEGORIES = [
  { slug: 'tutorial', name: '教程' },
  { slug: 'dev', name: '开发实践' },
  { slug: 'agent', name: 'Agent' },
  { slug: 'llm', name: '大模型' },
  { slug: 'prompt', name: '提示工程' },
  { slug: 'rag', name: 'RAG' },
  { slug: 'multimodal', name: '多模态' },
  { slug: 'finetune', name: '训练微调' },
  { slug: 'inference', name: '推理部署' },
  { slug: 'data', name: '数据工程' },
  { slug: 'eval', name: '评测' },
  { slug: 'safety', name: '安全对齐' },
  { slug: 'embodied', name: '具身智能' },
  { slug: 'product', name: '产品设计' },
  { slug: 'industry', name: '行业观察' },
  { slug: 'research', name: '学术前沿' },
] as const;

export type LibraryCategorySlug = (typeof LIBRARY_CATEGORIES)[number]['slug'];

export const CATEGORY_NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  LIBRARY_CATEGORIES.map((c) => [c.slug, c.name]),
);

export function isLibraryCategory(v: unknown): v is LibraryCategorySlug {
  return typeof v === 'string' && v in CATEGORY_NAME_BY_SLUG;
}

/** Sanitize a client-supplied categories value: known slugs, deduped, max 4. */
export function cleanCategories(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isLibraryCategory))].slice(0, 4);
}

/** One extracted chapter: sanitized reading HTML + plain text (paragraphs joined by '\n\n'). */
export interface ExtractedChapter {
  title: string | null;
  html: string;
  text: string;
  /** PDF only: 0-based inclusive page span backing this chapter. */
  pageStart?: number;
  pageEnd?: number;
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
