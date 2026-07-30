// Office OOXML extraction for 知识库: PPTX (one chapter per slide) and DOCX
// (chapters split at Heading-1 paragraphs). Both are zip containers read with
// the same capped streaming as EPUB; text comes out of the XML via
// fast-xml-parser with a tolerant shape walk.

import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { FetchUrlError } from './fetch-url';
import { htmlToPlainText, sanitizeChapterHtml } from './sanitize';
import { detectLanguage, type ExtractedChapter, type ExtractedDoc } from './types';

const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_SLIDES = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

function unsupported(message: string): FetchUrlError {
  return new FetchUrlError('unsupported_content', message);
}

function readEntry(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let stream: NodeJS.ReadableStream;
    try {
      stream = file.nodeStream('nodebuffer');
    } catch {
      settle(null);
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let capped = false;
    stream.on('data', (chunk: Buffer) => {
      if (capped) return;
      total += chunk.length;
      if (total > MAX_ENTRY_BYTES) {
        capped = true;
        chunks.length = 0;
      } else {
        chunks.push(chunk);
      }
    });
    stream.on('error', () => settle(null));
    stream.on('end', () => settle(capped ? null : Buffer.concat(chunks).toString('utf8')));
    stream.resume();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Collect every string under the given key name anywhere in a parsed XML tree. */
function collectText(node: unknown, key: string, out: string[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, key, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const local = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
    if (local === key) {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'number') out.push(String(v));
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string' || typeof item === 'number') out.push(String(item));
          else if (item && typeof item === 'object' && '#text' in (item as object)) {
            out.push(String((item as Record<string, unknown>)['#text'] ?? ''));
          } else collectText(item, key, out);
        }
      } else if (v && typeof v === 'object') {
        if ('#text' in (v as object)) out.push(String((v as Record<string, unknown>)['#text'] ?? ''));
        else collectText(v, key, out);
      }
    } else if (k !== '@_' && !k.startsWith('@_')) {
      collectText(v, key, out);
    }
  }
}

/** Paragraph-level walk: returns each <a:p>/<w:p> node found under `node`. */
function collectParagraphNodes(node: unknown, localName: string, out: unknown[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectParagraphNodes(item, localName, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k.startsWith('@_')) continue;
    const local = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
    if (local === localName) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
      // paragraphs don't nest — no need to recurse INTO them for more <p>
      continue;
    }
    collectParagraphNodes(v, localName, out);
  }
}

// ── PPTX ─────────────────────────────────────────────────────────────────────

export async function extractPptx(buf: Buffer): Promise<ExtractedDoc> {
  const zip = await JSZip.loadAsync(buf).catch(() => null);
  if (!zip) throw unsupported('无法读取 PPTX 文件');

  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
      const nb = Number.parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
      return na - nb;
    })
    .slice(0, MAX_SLIDES);
  if (slidePaths.length === 0) throw unsupported('PPTX 中没有找到幻灯片');

  const chapters: ExtractedChapter[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await readEntry(zip, slidePaths[i]);
    if (!xml) continue;
    let tree: unknown;
    try {
      tree = parser.parse(xml);
    } catch {
      continue;
    }
    // One paragraph per <a:p>; runs (<a:t>) inside a paragraph join without
    // separators (they're intra-line text runs).
    const paraNodes: unknown[] = [];
    collectParagraphNodes(tree, 'p', paraNodes);
    const paragraphs = paraNodes
      .map((p) => {
        const runs: string[] = [];
        collectText(p, 't', runs);
        return runs.join('').trim();
      })
      .filter(Boolean);
    if (paragraphs.length === 0) continue;

    const title = paragraphs[0].slice(0, 120);
    const bodyHtml =
      `<h2>${escapeHtml(title)}</h2>` +
      paragraphs
        .slice(1)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('');
    const html = sanitizeChapterHtml(bodyHtml, { baseUrl: null });
    const text = htmlToPlainText(html);
    if (!text) continue;
    chapters.push({ title: `第 ${i + 1} 页 · ${title}`.slice(0, 150), html, text });
  }
  if (chapters.length === 0) throw unsupported('未能从 PPTX 中提取任何文字内容');

  const allText = chapters.map((c) => c.text).join('\n\n');
  return {
    title: '',
    author: null,
    language: detectLanguage(allText),
    siteName: null,
    publishedAt: null,
    coverRemoteUrl: null,
    coverBuffer: null,
    chapters,
  };
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

interface DocxPara {
  text: string;
  headingLevel: number; // 0 = body text
}

function docxParagraphs(tree: unknown): DocxPara[] {
  const nodes: unknown[] = [];
  collectParagraphNodes(tree, 'p', nodes);
  const out: DocxPara[] = [];
  for (const p of nodes) {
    const runs: string[] = [];
    collectText(p, 't', runs);
    const text = runs.join('').trim();
    if (!text) continue;
    // Heading style: w:pPr > w:pStyle @w:val="Heading1|2|..."
    const styles: string[] = [];
    collectStyleVals(p, styles);
    const heading = styles
      .map((s) => s.match(/^(?:Heading|heading)\s?([1-6])$/)?.[1])
      .find(Boolean);
    out.push({ text, headingLevel: heading ? Number.parseInt(heading, 10) : 0 });
  }
  return out;
}

function collectStyleVals(node: unknown, out: string[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectStyleVals(item, out);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const local = k.includes(':') ? k.slice(k.indexOf(':') + 1) : k;
    if (local === 'pStyle' && v && typeof v === 'object') {
      const val = (v as Record<string, unknown>)['@_w:val'] ?? (v as Record<string, unknown>)['@_val'];
      if (typeof val === 'string') out.push(val);
    } else if (!k.startsWith('@_')) {
      collectStyleVals(v, out);
    }
  }
}

export async function extractDocx(buf: Buffer): Promise<ExtractedDoc> {
  const zip = await JSZip.loadAsync(buf).catch(() => null);
  if (!zip) throw unsupported('无法读取 DOCX 文件');
  const xml = await readEntry(zip, 'word/document.xml');
  if (!xml) throw unsupported('DOCX 结构无效（缺少 document.xml）');

  let tree: unknown;
  try {
    tree = parser.parse(xml);
  } catch {
    throw unsupported('无法解析 DOCX 内容');
  }
  const paragraphs = docxParagraphs(tree);
  if (paragraphs.length === 0) throw unsupported('未能从 DOCX 中提取任何文字内容');

  const paraHtml = (p: DocxPara) =>
    p.headingLevel > 0
      ? `<h${Math.min(3, p.headingLevel)}>${escapeHtml(p.text)}</h${Math.min(3, p.headingLevel)}>`
      : `<p>${escapeHtml(p.text)}</p>`;

  // Split at Heading-1 boundaries when the doc really uses them.
  const h1Count = paragraphs.filter((p) => p.headingLevel === 1).length;
  const chapters: ExtractedChapter[] = [];
  if (h1Count >= 2) {
    let current: DocxPara[] = [];
    let currentTitle: string | null = null;
    const push = () => {
      if (current.length === 0) return;
      const html = sanitizeChapterHtml(current.map(paraHtml).join(''), { baseUrl: null });
      const text = htmlToPlainText(html);
      if (text) chapters.push({ title: currentTitle, html, text });
    };
    for (const p of paragraphs) {
      if (p.headingLevel === 1) {
        push();
        current = [p];
        currentTitle = p.text.slice(0, 150);
      } else {
        current.push(p);
      }
    }
    push();
  }
  if (chapters.length === 0) {
    const html = sanitizeChapterHtml(paragraphs.map(paraHtml).join(''), { baseUrl: null });
    const text = htmlToPlainText(html);
    if (!text) throw unsupported('未能从 DOCX 中提取任何文字内容');
    chapters.push({ title: null, html, text });
  }

  const allText = chapters.map((c) => c.text).join('\n\n');
  return {
    title: '',
    author: null,
    language: detectLanguage(allText),
    siteName: null,
    publishedAt: null,
    coverRemoteUrl: null,
    coverBuffer: null,
    chapters,
  };
}
