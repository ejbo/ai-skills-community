// Web-article extraction for 知识库: jsdom + @mozilla/readability.
// Metadata first (og:* / meta / JSON-free heuristics, WeChat special-case),
// then Readability on a cloned document, sanitized into reading HTML.
// Long articles with clear h1/h2 structure split into chapters.

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { FetchUrlError } from './fetch-url';
import { htmlToPlainText, sanitizeChapterHtml } from './sanitize';
import { detectLanguage, type ExtractedChapter, type ExtractedDoc } from './types';

const MIN_CONTENT_CHARS = 200;
const SPLIT_MIN_HEADINGS = 3;
const SPLIT_MIN_CHARS = 6000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function metaContent(doc: Document, selector: string): string | null {
  const content = doc.querySelector(selector)?.getAttribute('content')?.trim();
  return content || null;
}

function readableDomain(host: string): string {
  return host.replace(/^(www|m|blog)\./i, '');
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function absolutize(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface PageMeta {
  title: string;
  author: string | null;
  siteName: string | null;
  publishedAt: Date | null;
  coverRemoteUrl: string | null;
}

function extractMeta(doc: Document, html: string, url: string): PageMeta {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // keep empty
  }

  const title =
    metaContent(doc, 'meta[property="og:title"]') ??
    (doc.title || '').trim() ??
    '';
  const h1 = doc.querySelector('h1')?.textContent?.trim() ?? '';
  const finalTitle = title || h1 || readableDomain(host) || '未命名文档';

  let author =
    metaContent(doc, 'meta[name="author"]') ??
    metaContent(doc, 'meta[property="article:author"]');
  if (author && /^https?:\/\//i.test(author)) author = null;

  let siteName = metaContent(doc, 'meta[property="og:site_name"]');
  if (siteName === '微信公众平台') siteName = null;

  // WeChat articles: the real account name lives in #js_name / var nickname.
  if (host === 'mp.weixin.qq.com') {
    const jsName = doc.querySelector('#js_name')?.textContent?.trim();
    const nickname = html.match(/var\s+nickname\s*=\s*["']([^"']+)["']/)?.[1]?.trim();
    const account = jsName || nickname || null;
    if (account) {
      author = author ?? account;
      siteName = account;
    }
  }
  if (!siteName && host) siteName = readableDomain(host);

  const publishedAt =
    parseDate(metaContent(doc, 'meta[property="article:published_time"]')) ??
    parseDate(
      metaContent(doc, 'meta[name="datePublished"]') ??
        metaContent(doc, 'meta[itemprop="datePublished"]'),
    ) ??
    parseDate(doc.querySelector('time[datetime]')?.getAttribute('datetime'));

  const coverRemoteUrl =
    absolutize(metaContent(doc, 'meta[property="og:image"]'), url) ??
    absolutize(
      metaContent(doc, 'meta[name="twitter:image"]') ??
        metaContent(doc, 'meta[property="twitter:image"]'),
      url,
    ) ??
    absolutize(doc.querySelector('link[rel="image_src"]')?.getAttribute('href') ?? null, url);

  return { title: finalTitle, author, siteName, publishedAt, coverRemoteUrl };
}

/**
 * No-Readability fallback: pick the DOM container with the most paragraph-like
 * text. Most sites don't use <article>/<main>, so we score EVERY block
 * container by the combined length of its direct-ish <p>/<li>/<blockquote>/<pre>
 * descendants and take the densest — this handles div-soup layouts too.
 */
function fallbackContainer(doc: Document): Element {
  const BLOCK = 'p, li, blockquote, pre, h1, h2, h3, h4';
  // Prefer semantic roots when they actually hold the bulk of the text.
  const candidates = new Set<Element>();
  for (const el of Array.from(doc.querySelectorAll('article, main, [role="main"]'))) {
    candidates.add(el);
  }
  // Plus generic containers that hold many block elements.
  for (const el of Array.from(doc.querySelectorAll('div, section'))) {
    if (el.querySelectorAll(BLOCK).length >= 3) candidates.add(el);
  }

  let best: Element | null = null;
  let bestLen = 0;
  for (const el of candidates) {
    // Skip obvious chrome.
    const cls = `${el.id} ${el.className}`.toLowerCase();
    if (/(^|[\s_-])(nav|footer|header|sidebar|comment|menu|share|related|recommend)([\s_-]|$)/.test(cls)) {
      continue;
    }
    let len = 0;
    for (const b of Array.from(el.querySelectorAll(BLOCK))) {
      const tl = (b.textContent ?? '').trim().length;
      if (tl >= 20) len += tl;
    }
    if (len > bestLen) {
      best = el;
      bestLen = len;
    }
  }
  return best ?? doc.body;
}

/** Last-resort content from JSON-LD Article/NewsArticle `articleBody`. */
function jsonLdArticleBody(doc: Document): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const raw = JSON.parse(script.textContent ?? 'null');
      const nodes = Array.isArray(raw) ? raw : raw?.['@graph'] ? raw['@graph'] : [raw];
      for (const node of nodes) {
        const body = node?.articleBody;
        if (typeof body === 'string' && body.trim().length > 200) return body.trim();
      }
    } catch {
      /* malformed JSON-LD — skip */
    }
  }
  return null;
}

/** Split sanitized article HTML at top-level h1/h2 boundaries (long-form only). */
function splitChapters(sanitized: string, fullText: string): ExtractedChapter[] {
  const single: ExtractedChapter[] = [{ title: null, html: sanitized, text: fullText }];
  if (fullText.length <= SPLIT_MIN_CHARS) return single;

  const frag = JSDOM.fragment(sanitized);
  const topHeadings = Array.from(frag.childNodes).filter(
    (n) => n.nodeType === 1 && ((n as Element).tagName === 'H1' || (n as Element).tagName === 'H2'),
  );
  if (topHeadings.length < SPLIT_MIN_HEADINGS) return single;

  const doc = frag.ownerDocument;
  interface Part {
    title: string | null;
    holder: Element;
  }
  const parts: Part[] = [{ title: null, holder: doc.createElement('div') }];
  for (const node of Array.from(frag.childNodes)) {
    const isHeading =
      node.nodeType === 1 &&
      ((node as Element).tagName === 'H1' || (node as Element).tagName === 'H2');
    if (isHeading) {
      const title = (node.textContent ?? '').trim() || null;
      parts.push({ title, holder: doc.createElement('div') });
    }
    parts[parts.length - 1].holder.appendChild(node);
  }

  const chapters: ExtractedChapter[] = [];
  for (const part of parts) {
    const html = part.holder.innerHTML.trim();
    if (!html) continue;
    const text = htmlToPlainText(html);
    if (!text && !/<img/i.test(html)) continue;
    chapters.push({ title: part.title, html, text });
  }
  return chapters.length > 1 ? chapters : single;
}

/**
 * Extract a fetched HTML page into a normalized document.
 * Throws FetchUrlError('unsupported_content') when no usable content exists.
 */
/**
 * Promote lazy-loaded image URLs into `src` BEFORE Readability/sanitize run.
 * WeChat 公众号 (and most CMSes) ship `<img data-src="…">` with an empty or
 * 1px-placeholder src — without this every article image is dropped.
 */
function promoteLazyImages(document: Document): void {
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    const hasRealSrc = /^https?:\/\//i.test(src) && !/\b(1x1|pixel|blank|spacer)\b/i.test(src);
    if (hasRealSrc) continue;
    const lazy =
      img.getAttribute('data-src') ??
      img.getAttribute('data-original') ??
      img.getAttribute('data-lazy-src') ??
      img.getAttribute('data-actualsrc');
    if (lazy && /^(https?:)?\/\//i.test(lazy.trim())) {
      img.setAttribute('src', lazy.trim());
      continue;
    }
    // srcset fallback: pick the largest candidate.
    const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
    if (!srcset) continue;
    let best: { url: string; w: number } | null = null;
    for (const part of srcset.split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d?.endsWith('w') ? Number.parseInt(d, 10) : 0;
      if (!best || w > best.w) best = { url: u, w: Number.isFinite(w) ? w : 0 };
    }
    if (best && /^(https?:)?\/\//i.test(best.url)) img.setAttribute('src', best.url);
  }
}

export function extractArticle(html: string, url: string): ExtractedDoc {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const meta = extractMeta(document, html, url);
  promoteLazyImages(document);

  let contentHtml: string | null = null;
  try {
    const cloned = document.cloneNode(true) as Document;
    const parsed = new Readability(cloned).parse();
    if (parsed?.content) contentHtml = parsed.content;
  } catch {
    contentHtml = null;
  }

  let sanitized = contentHtml ? sanitizeChapterHtml(contentHtml, { baseUrl: url }) : '';
  let text = sanitized ? htmlToPlainText(sanitized) : '';

  // Fallback 1: densest paragraph container (handles div-soup / no <article>).
  if (text.length < MIN_CONTENT_CHARS) {
    const container = fallbackContainer(document);
    const s = sanitizeChapterHtml(container.innerHTML, { baseUrl: url });
    const tx = htmlToPlainText(s);
    if (tx.length > text.length) {
      sanitized = s;
      text = tx;
    }
  }
  // Fallback 2: JSON-LD articleBody (structured data many CMSes ship).
  if (text.length < MIN_CONTENT_CHARS) {
    const body = jsonLdArticleBody(document);
    if (body && body.length > text.length) {
      const paras = body
        .split(/\n{2,}|\r\n\r\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      const html = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
      sanitized = sanitizeChapterHtml(html, { baseUrl: url });
      text = htmlToPlainText(sanitized);
    }
  }
  // Fallback 3: whole body text (best-effort — better than nothing).
  if (text.length < MIN_CONTENT_CHARS) {
    const s = sanitizeChapterHtml(document.body?.innerHTML ?? '', { baseUrl: url });
    const tx = htmlToPlainText(s);
    if (tx.length > text.length) {
      sanitized = s;
      text = tx;
    }
  }
  if (text.length < MIN_CONTENT_CHARS) {
    throw new FetchUrlError(
      'unsupported_content',
      '无法从该网页提取正文——该页面可能依赖 JavaScript 动态加载，或有反爬限制。可尝试保存为 PDF/HTML 后上传。',
    );
  }

  const chapters = splitChapters(sanitized, text);

  return {
    title: meta.title,
    author: meta.author,
    language: detectLanguage(text),
    siteName: meta.siteName,
    publishedAt: meta.publishedAt,
    coverRemoteUrl: meta.coverRemoteUrl,
    coverBuffer: null,
    chapters,
  };
}
