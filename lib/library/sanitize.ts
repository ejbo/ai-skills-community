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

// `width`/`height` are kept so the browser can RESERVE the image's box before
// it decodes. Without them a lazy image is 0px tall until it loads and the
// article grows by hundreds of px under the reader's pointer — which is one of
// the ways a drag-selection ends up covering the wrong text.
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'style', 'width', 'height',
];

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

// Elements that already carry their own block semantics — a stray inline node
// sitting next to one of these still needs wrapping, but these are left alone.
const BLOCK_LEVEL = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'pre', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'hr',
]);

const GENERIC_CONTAINERS = ['div', 'section', 'article', 'main', 'header', 'footer'];

/**
 * Turn generic containers into real blocks BEFORE sanitizing.
 *
 * DOMPurify's allowlist has no `div`, so it UNWRAPS one — and by then the
 * boundary is gone: `<div>a</div><div>b</div>` becomes the single text run
 * "ab". A contenteditable surface (Chrome emits `<div>` per Enter) would
 * therefore have its whole paragraph structure flattened on save, taking
 * `htmlToPlainText`'s '\n\n' boundaries — and with them the chunker and every
 * highlight offset — along with it.
 *
 * A container holding only inline content becomes a `<p>`; one that already
 * holds blocks is unwrapped (its children carry the structure). Children are
 * processed before parents, so nested wrappers collapse correctly.
 *
 * Runs on untrusted input, but only restructures elements inside a detached
 * document — DOMParser executes nothing — and the result still goes through
 * DOMPurify below.
 */
function preNormalizeContainers(html: string): string {
  const { parser } = getDom();
  const doc = parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const containers = Array.from(doc.body.querySelectorAll(GENERIC_CONTAINERS.join(',')));
  // Reverse document order ⇒ descendants first.
  for (let i = containers.length - 1; i >= 0; i--) {
    const el = containers[i];
    const parent = el.parentNode;
    if (!parent) continue;
    // Inside preformatted content a <p> is invalid and .reader-prose's paragraph
    // margins would blow the code block apart — unwrap instead. (Reachable from
    // the WYSIWYG editor's 代码块 button, which wraps the caret's <div> in <pre>.)
    const inPre = !!el.closest('pre, code');
    const hasBlockChild = Array.from(el.children).some((c) =>
      BLOCK_LEVEL.has(c.tagName.toLowerCase()),
    );
    if (hasBlockChild || inPre) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    } else {
      const p = doc.createElement('p');
      while (el.firstChild) p.appendChild(el.firstChild);
      parent.replaceChild(p, el);
    }
  }
  return doc.body.innerHTML;
}

/**
 * Guarantee that every remaining top-level node is a block element — bare text
 * and inline runs (Safari's contenteditable emits those, as does a paste from
 * Word/WeChat) are wrapped in `<p>`.
 */
function wrapStrayInlineContent(body: HTMLElement, doc: Document): void {
  const isStray = (node: ChildNode): boolean => {
    if (node.nodeType === TEXT_NODE) return Boolean((node.nodeValue ?? '').trim());
    if (node.nodeType !== ELEMENT_NODE) return false;
    return !BLOCK_LEVEL.has((node as Element).tagName.toLowerCase());
  };

  let run: ChildNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const p = doc.createElement('p');
    run[0].before(p);
    for (const node of run) p.appendChild(node);
    run = [];
  };
  for (const node of Array.from(body.childNodes)) {
    if (isStray(node)) {
      run.push(node);
    } else {
      flush();
      // Drop whitespace-only text between blocks rather than starting a run.
      if (node.nodeType === TEXT_NODE && !(node.nodeValue ?? '').trim()) node.remove();
    }
  }
  flush();
}

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

/**
 * Re-relativize one of OUR OWN library-file URLs that came back origin-absolute
 * — Chrome's editing pipeline resolves URLs whenever content leaves and
 * re-enters a contenteditable through the clipboard, and media URLs are STORED
 * root-relative so content stays portable between the root and `/ai-community`
 * deploys. The pathname must start with the prefix directly or after exactly
 * one leading segment (the deploy basePath); anything deeper is a foreign URL
 * that merely happens to contain the substring.
 */
function relativizeLibraryFile(value: string): string | null {
  try {
    const path = new URL(value).pathname;
    if (path.startsWith(LIBRARY_FILE_PREFIX)) return path;
    const secondSlash = path.indexOf('/', 1);
    if (secondSlash > 0 && path.slice(secondSlash).startsWith(LIBRARY_FILE_PREFIX)) {
      return path.slice(secondSlash);
    }
    return null;
  } catch {
    return null;
  }
}

function absolutize(raw: string, baseUrl: string | null | undefined): string {
  let value = raw.trim();
  if (!value) return value;
  if (value.startsWith('//')) value = `https:${value}`;
  if (isHttpUrl(value)) {
    // Only on the local paths (chapter edit / file upload, baseUrl null) — when
    // re-extracting a foreign page its own URLs must stay untouched.
    return (baseUrl ? null : relativizeLibraryFile(value)) ?? value;
  }
  if (value.startsWith(LIBRARY_FILE_PREFIX) || value.startsWith('mailto:')) {
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
  const clean = purify.sanitize(preNormalizeContainers(html ?? ''), {
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
      continue;
    }
    // A mousedown on an image otherwise starts a NATIVE image drag and no text
    // selection is created at all — dragging across a figure just fails.
    img.setAttribute('draggable', 'false');
    // width/height survive the allowlist above; combined with reader.css's
    // `height: auto` the UA derives an aspect-ratio from them and reserves the
    // box before the lazy image decodes, so the text below stops jumping.
    // (Sources that ship no dimensions still reflow — nothing to reserve from.)
  }

  for (const el of Array.from(doc.body.querySelectorAll('[style]'))) {
    const filtered = filterStyle(el.getAttribute('style') ?? '');
    if (filtered) el.setAttribute('style', filtered);
    else el.removeAttribute('style');
  }

  // Wrap stray inline runs BEFORE the empty-paragraph sweep, so a run that
  // turns out to be blank (a lone <br>, a whitespace <span>) is cleaned up in
  // the same pass instead of shipping a margin-bearing empty paragraph.
  wrapStrayInlineContent(doc.body, doc);

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

// ── 译文 block mapping ──────────────────────────────────────────────────────
// The whole-chapter 译文 keeps the ORIGINAL structure and swaps only the text
// of each leaf block. Nothing is re-parsed from model output, so no tag can be
// corrupted and no markup can be injected — the translation only ever reaches
// the DOM through `textContent`.

/** Leaf blocks — block elements that contain no other block element. */
const TRANSLATABLE_BLOCKS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'td', 'th', 'figcaption',
];

function leafBlocks(body: HTMLElement): Element[] {
  const sel = TRANSLATABLE_BLOCKS.join(',');
  return Array.from(body.querySelectorAll(sel)).filter((el) => {
    // Only the innermost block carries text we should replace.
    if (el.querySelector(sel)) return false;
    // `pre`/`code` is source code — translating it corrupts it.
    if (el.closest('pre, code')) return false;
    // A block whose text sits beside an image would lose the image to
    // textContent, so it stays in the source language.
    if (el.querySelector('img')) return false;
    return Boolean((el.textContent ?? '').trim());
  });
}

/** Source text of every translatable block, in document order. */
export function htmlBlockTexts(html: string): string[] {
  if (!html) return [];
  const { parser } = getDom();
  const doc = parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  return leafBlocks(doc.body).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * Rebuild the chapter with each block's text replaced by its translation.
 * `bySource` is keyed by whitespace-normalized source text (see
 * lib/library/translation.ts). Blocks with no translation keep the original,
 * so a partial pass still renders a coherent page.
 */
export function applyBlockTranslations(html: string, bySource: Map<string, string>): string {
  if (!html) return html;
  const { parser } = getDom();
  const doc = parser.parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  for (const el of leafBlocks(doc.body)) {
    const source = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const translated = bySource.get(source);
    if (translated) el.textContent = translated;
  }
  return doc.body.innerHTML.trim();
}
