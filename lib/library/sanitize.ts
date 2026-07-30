// 知识库 reading-HTML sanitizer. DOMPurify bound to a module-singleton jsdom
// window (server-side), plus a post-pass DOM walk that absolutizes URLs,
// unwraps unsafe links, drops unservable images and strips empty paragraphs.
// Chapter HTML is sanitized ONCE at ingest and later rendered with
// dangerouslySetInnerHTML — nothing unsanitized may ever reach the reader.

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'a', 'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup',
  'br', 'hr', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'mark',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'style'];

// Inline styles survive ONLY through this whitelist (post-pass below) — enough
// to keep the source's structural formatting (alignment, emphasis weight,
// indent) without letting author colors/fonts fight the reader themes.
const ALLOWED_STYLE_PROPS = new Set([
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-indent',
]);

function filterStyle(raw: string): string {
  const kept: string[] = [];
  for (const decl of raw.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (!/^[\w\s.%#-]+$/.test(value)) continue;
    kept.push(`${prop}: ${value.replace(/\s*!important/gi, '')}`);
  }
  return kept.join('; ');
}

const LIBRARY_FILE_PREFIX = '/api/library/file/';

interface DomSingleton {
  purify: ReturnType<typeof createDOMPurify>;
  parser: DOMParser;
}

let singleton: DomSingleton | null = null;

function getDom(): DomSingleton {
  if (!singleton) {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
    singleton = { purify, parser: new window.DOMParser() };
  }
  return singleton;
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function absolutize(raw: string, baseUrl: string | null | undefined): string {
  let value = raw.trim();
  if (!value) return value;
  if (value.startsWith('//')) value = `https:${value}`;
  if (isHttpUrl(value) || value.startsWith(LIBRARY_FILE_PREFIX) || value.startsWith('mailto:')) {
    return value;
  }
  if (!baseUrl) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

/**
 * Sanitize extracted content into safe reading HTML. `baseUrl` (the page's
 * final URL for web articles, null for EPUB/PDF) resolves relative src/href.
 */
export function sanitizeChapterHtml(html: string, opts: { baseUrl?: string | null }): string {
  const { purify, parser } = getDom();
  const clean = purify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  const doc = parser.parseFromString(`<!doctype html><html><body>${clean}</body></html>`, 'text/html');
  const baseUrl = opts.baseUrl ?? null;

  for (const a of Array.from(doc.body.querySelectorAll('a'))) {
    const href = absolutize(a.getAttribute('href') ?? '', baseUrl);
    if (isHttpUrl(href) || href.startsWith('mailto:')) {
      a.setAttribute('href', href);
    } else {
      // Internal / non-web link — keep the text, drop the anchor.
      a.replaceWith(doc.createTextNode(a.textContent ?? ''));
    }
  }

  for (const img of Array.from(doc.body.querySelectorAll('img'))) {
    const src = absolutize(img.getAttribute('src') ?? '', baseUrl);
    if (isHttpUrl(src)) {
      img.setAttribute('src', src);
      img.setAttribute('loading', 'lazy');
      img.setAttribute('referrerpolicy', 'no-referrer');
    } else if (src.startsWith(LIBRARY_FILE_PREFIX)) {
      img.setAttribute('src', src);
      img.setAttribute('loading', 'lazy');
    } else {
      img.remove();
    }
  }

  for (const el of Array.from(doc.body.querySelectorAll('[style]'))) {
    const filtered = filterStyle(el.getAttribute('style') ?? '');
    if (filtered) el.setAttribute('style', filtered);
    else el.removeAttribute('style');
  }

  for (const p of Array.from(doc.body.querySelectorAll('p'))) {
    if (!(p.textContent ?? '').trim() && !p.querySelector('img')) p.remove();
  }

  return doc.body.innerHTML.trim();
}

// Tags whose boundaries become paragraph breaks in the plain-text projection.
const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'blockquote', 'pre', 'td', 'th', 'tr',
  'figure', 'figcaption', 'table', 'ul', 'ol', 'hr',
  'div', 'section', 'article',
]);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
// Block-boundary sentinel — the HTML parser never leaves a NUL in text nodes.
const SEP = String.fromCharCode(0);

/**
 * Block-aware plain text: h1-h6/p/li/blockquote/pre/td (etc.) become
 * '\n\n'-separated paragraphs with inner whitespace collapsed. This string is
 * the chapter `text` — the chunker's and highlight offsets' source of truth.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const { parser } = getDom();
  const doc = parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const parts: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      parts.push(' ');
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) parts.push(SEP);
    for (const child of Array.from(el.childNodes)) visit(child);
    if (block) parts.push(SEP);
  };

  for (const child of Array.from(doc.body.childNodes)) visit(child);

  return parts
    .join('')
    .split(SEP)
    .map((seg) => seg.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}
