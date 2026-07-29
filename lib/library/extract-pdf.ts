// PDF extraction for 知识库 via unpdf (serverless pdf.js build).
// Per-page text → paragraph reflow (hard-wrapped lines joined, blank lines
// split); chapters from the PDF outline when resolvable, else 12-page groups;
// scanned PDFs (no text layer) degrade to a notice chapter with zero chunks so
// the reader falls back to the embedded original file.

import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { detectLanguage, type ExtractedChapter, type ExtractedDoc } from './types';

const FALLBACK_GROUP_PAGES = 12;
const SCANNED_CHARS_PER_PAGE = 20;
const SCANNED_NOTICE_HTML = '<p>该 PDF 为扫描版，暂不支持文字提取；请使用原文件阅读。</p>';

const CJK_CHAR_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;
const SENTENCE_END_RE = /[。！？．.!?…：:;；"”』」）)]$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function joinWrappedLine(current: string, line: string): string {
  if (!current) return line;
  const tail = current[current.length - 1];
  const head = line[0];
  const cjkBoundary = CJK_CHAR_RE.test(tail) || CJK_CHAR_RE.test(head);
  return current + (cjkBoundary ? '' : ' ') + line;
}

/** Reflow page text lines into paragraphs (continues across page boundaries). */
function pagesToParagraphs(pageTexts: string[]): string[] {
  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    const t = current.trim();
    if (t) paragraphs.push(t);
    current = '';
  };
  for (const page of pageTexts) {
    for (const rawLine of page.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        flush();
        continue;
      }
      current = joinWrappedLine(current, line);
      if (SENTENCE_END_RE.test(line)) flush();
    }
  }
  flush();
  return paragraphs;
}

interface PageSpan {
  title: string | null;
  start: number; // inclusive 0-based page index
  end: number; // exclusive
}

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

/** Top-level outline entries → page spans; null on any trouble (graceful). */
async function outlineSpans(pdf: PdfProxy, totalPages: number): Promise<PageSpan[] | null> {
  try {
    const outline = await pdf.getOutline();
    if (!outline || outline.length < 2) return null;

    const entries: { title: string | null; page: number }[] = [];
    for (const item of outline) {
      let dest: unknown = item.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest) || dest.length === 0) return null;
      const ref = dest[0];
      let pageIndex: number;
      if (typeof ref === 'number') {
        pageIndex = ref;
      } else if (ref && typeof ref === 'object') {
        pageIndex = await pdf.getPageIndex(ref as Parameters<PdfProxy['getPageIndex']>[0]);
      } else {
        return null;
      }
      if (!Number.isFinite(pageIndex) || pageIndex < 0 || pageIndex >= totalPages) return null;
      entries.push({ title: (item.title ?? '').trim() || null, page: pageIndex });
    }

    entries.sort((a, b) => a.page - b.page);

    const spans: PageSpan[] = [];
    if (entries[0].page > 0) {
      spans.push({ title: null, start: 0, end: entries[0].page });
    }
    for (let i = 0; i < entries.length; i++) {
      const start = entries[i].page;
      const end = i + 1 < entries.length ? entries[i + 1].page : totalPages;
      if (end <= start) continue; // two entries on the same page — keep the first
      spans.push({ title: entries[i].title, start, end });
    }
    return spans.length >= 2 ? spans : null;
  } catch {
    return null;
  }
}

function fallbackSpans(totalPages: number): PageSpan[] {
  if (totalPages <= FALLBACK_GROUP_PAGES) {
    return [{ title: null, start: 0, end: totalPages }];
  }
  const spans: PageSpan[] = [];
  for (let start = 0, n = 1; start < totalPages; start += FALLBACK_GROUP_PAGES, n++) {
    spans.push({
      title: `第 ${n} 部分`,
      start,
      end: Math.min(totalPages, start + FALLBACK_GROUP_PAGES),
    });
  }
  return spans;
}

function buildChapter(span: PageSpan, pages: string[]): ExtractedChapter {
  const paragraphs = pagesToParagraphs(pages.slice(span.start, span.end));
  return {
    title: span.title,
    html: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n'),
    text: paragraphs.join('\n\n'),
  };
}

export async function extractPdf(buf: Buffer): Promise<ExtractedDoc> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((p) => p ?? '');

    let title = '';
    let author: string | null = null;
    try {
      const { info } = await getMeta(pdf);
      const rawTitle = typeof info?.Title === 'string' ? info.Title.trim() : '';
      if (rawTitle && rawTitle.toLowerCase() !== 'untitled') title = rawTitle;
      const rawAuthor = typeof info?.Author === 'string' ? info.Author.trim() : '';
      if (rawAuthor) author = rawAuthor;
    } catch {
      // metadata is best-effort
    }

    const base: Omit<ExtractedDoc, 'chapters' | 'language'> = {
      title,
      author,
      siteName: null,
      publishedAt: null,
      coverRemoteUrl: null,
      coverBuffer: null,
    };

    const totalChars = pages.reduce((n, p) => n + p.replace(/\s/g, '').length, 0);
    if (totalChars < totalPages * SCANNED_CHARS_PER_PAGE) {
      return {
        ...base,
        language: null,
        chapters: [{ title: null, html: SCANNED_NOTICE_HTML, text: '' }],
      };
    }

    const spans = (await outlineSpans(pdf, totalPages)) ?? fallbackSpans(totalPages);
    const chapters = spans
      .map((span) => buildChapter(span, pages))
      .filter((c) => c.text.length > 0);
    if (chapters.length === 0) {
      return {
        ...base,
        language: null,
        chapters: [{ title: null, html: SCANNED_NOTICE_HTML, text: '' }],
      };
    }

    const allText = chapters.map((c) => c.text).join('\n\n');
    return { ...base, language: detectLanguage(allText), chapters };
  } finally {
    try {
      // Runtime pdf.js exposes destroy() on the proxy; unpdf's bundled types omit it.
      const disposable = pdf as unknown as { destroy?: () => Promise<void> };
      if (typeof disposable.destroy === 'function') await disposable.destroy();
      else await pdf.cleanup();
    } catch {
      // freeing pdf.js worker memory is best-effort
    }
  }
}
