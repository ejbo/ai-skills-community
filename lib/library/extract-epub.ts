// EPUB extraction for 知识库: jszip + fast-xml-parser. OPF metadata + spine
// drive chapter order; titles come from the EPUB3 nav toc, then toc.ncx, then
// the chapter's first h1/h2, then 第 n 章. Embedded images are re-hosted via
// the caller-supplied saveImage callback (capped), the cover image is returned
// as raw bytes, and DRM'd books are rejected up front.

import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { FetchUrlError } from './fetch-url';
import { htmlToPlainText, sanitizeChapterHtml } from './sanitize';
import { detectLanguage, type ExtractedChapter, type ExtractedDoc } from './types';

const MAX_IMAGES_PER_BOOK = 40;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_CHAPTER_TEXT_CHARS = 20;
// Zip-bomb guards — memory protection only (there is deliberately NO upload
// size cap): a small EPUB may decompress to GBs, so entry reads are streamed
// with generous per-entry / whole-book ceilings far above any real book.
const MAX_TEXT_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_TEXT_CHARS = 128 * 1024 * 1024;

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string | null {
  if (typeof v === 'string' || typeof v === 'number') {
    const s = String(v).trim();
    return s || null;
  }
  if (Array.isArray(v)) return textOf(v[0]);
  if (v && typeof v === 'object') {
    return textOf((v as Record<string, unknown>)['#text']);
  }
  return null;
}

function zipDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Resolve an href relative to a directory inside the zip (posix, no leading /). */
function resolveZipPath(baseDir: string, href: string): string {
  let clean = href.split('#')[0].split('?')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // keep raw
  }
  const parts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  if (clean.startsWith('/')) parts.length = 0;
  for (const seg of clean.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function extFor(path: string, mediaType?: string): string | null {
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  const fromPath = m ? m[1].toLowerCase() : '';
  if (IMAGE_EXTS.has(fromPath)) return fromPath === 'jpeg' ? 'jpg' : fromPath;
  if (mediaType && IMAGE_EXT_BY_MIME[mediaType.toLowerCase()]) {
    return IMAGE_EXT_BY_MIME[mediaType.toLowerCase()];
  }
  return null;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

interface XmlNode {
  [key: string]: unknown;
}

function unsupported(message: string): FetchUrlError {
  return new FetchUrlError('unsupported_content', message);
}

/**
 * Stream a zip entry with a decompressed-size cap — null when missing, broken,
 * or over the cap (chunks beyond the cap are dropped, never buffered).
 */
function readEntryCapped(file: JSZip.JSZipObject, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: Buffer | null) => {
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
      if (total > maxBytes) {
        capped = true;
        chunks.length = 0;
      } else {
        chunks.push(chunk);
      }
    });
    stream.on('error', () => settle(null));
    stream.on('end', () => settle(capped ? null : Buffer.concat(chunks)));
    stream.resume();
  });
}

async function zipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const buf = await readEntryCapped(file, MAX_TEXT_ENTRY_BYTES);
  return buf ? buf.toString('utf8') : null;
}

async function zipBuffer(zip: JSZip, path: string, maxBytes: number): Promise<Buffer | null> {
  const file = zip.file(path);
  if (!file) return null;
  return readEntryCapped(file, maxBytes);
}

/** EPUB3 nav.xhtml toc → resolved-path → title map. */
function navTitleMap(navHtml: string, navDir: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const dom = new JSDOM(navHtml);
    const doc = dom.window.document;
    const nav =
      doc.querySelector('nav[epub\\:type="toc"]') ??
      doc.querySelector('nav[role="doc-toc"]') ??
      doc.querySelector('nav');
    if (!nav) return map;
    for (const a of Array.from(nav.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      const title = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!href || !title) continue;
      const path = resolveZipPath(navDir, href);
      if (path && !map.has(path)) map.set(path, title);
    }
  } catch {
    // toc is best-effort
  }
  return map;
}

/** toc.ncx navPoints → resolved-path → title map (EPUB2 fallback). */
function ncxTitleMap(ncxXml: string, ncxDir: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const parsed = parser.parse(ncxXml) as XmlNode;
    const ncx = (parsed.ncx ?? parsed['ncx:ncx']) as XmlNode | undefined;
    const navMap = ncx?.navMap as XmlNode | undefined;
    const walk = (points: XmlNode[]) => {
      for (const point of points) {
        const label = point.navLabel as XmlNode | undefined;
        const title = textOf(label?.text ?? label);
        const src = textOf((point.content as XmlNode | undefined)?.['@_src']);
        if (title && src) {
          const path = resolveZipPath(ncxDir, src);
          if (path && !map.has(path)) map.set(path, title);
        }
        walk(asArray(point.navPoint as XmlNode | XmlNode[] | undefined));
      }
    };
    walk(asArray(navMap?.navPoint as XmlNode | XmlNode[] | undefined));
  } catch {
    // toc is best-effort
  }
  return map;
}

function firstHeadingText(sanitizedHtml: string): string | null {
  try {
    const frag = JSDOM.fragment(sanitizedHtml);
    const h = frag.querySelector('h1, h2');
    const text = (h?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Extract an EPUB into a normalized document. `saveImage` stores an embedded
 * image and returns its root-relative public URL (null to skip the image).
 */
export async function extractEpub(
  buf: Buffer,
  saveImage: (data: Buffer, ext: string) => Promise<string | null>,
): Promise<ExtractedDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw unsupported('无法解析 EPUB 文件');
  }

  if (zip.file('META-INF/encryption.xml')) {
    throw unsupported('DRM 保护的 EPUB 无法导入');
  }

  const containerXml = await zipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw unsupported('EPUB 缺少 container.xml');
  let opfPath = '';
  try {
    const container = parser.parse(containerXml) as XmlNode;
    const rootfiles = (container.container as XmlNode | undefined)?.rootfiles as XmlNode | undefined;
    const rootfile = asArray(rootfiles?.rootfile as XmlNode | XmlNode[] | undefined)[0];
    opfPath = textOf(rootfile?.['@_full-path']) ?? '';
  } catch {
    opfPath = '';
  }
  if (!opfPath) throw unsupported('EPUB 结构无效（未找到 OPF）');

  const opfXml = await zipText(zip, opfPath);
  if (!opfXml) throw unsupported('EPUB 结构无效（OPF 缺失）');
  let pkg: XmlNode;
  try {
    const parsed = parser.parse(opfXml) as XmlNode;
    pkg = (parsed.package ?? parsed['opf:package']) as XmlNode;
    if (!pkg) throw new Error('no package');
  } catch {
    throw unsupported('EPUB 结构无效（OPF 解析失败）');
  }
  const opfDir = zipDirname(opfPath);

  const metadata = (pkg.metadata ?? pkg['opf:metadata'] ?? {}) as XmlNode;
  const title = textOf(metadata['dc:title']) ?? '';
  const author = textOf(metadata['dc:creator']);
  const dcLanguage = (textOf(metadata['dc:language']) ?? '').toLowerCase();
  const publishedAt = (() => {
    const raw = textOf(metadata['dc:date']);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  })();

  const manifest = new Map<string, ManifestItem>();
  for (const raw of asArray(((pkg.manifest ?? pkg['opf:manifest']) as XmlNode | undefined)?.item as XmlNode | XmlNode[] | undefined)) {
    const id = textOf(raw['@_id']);
    const href = textOf(raw['@_href']);
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: textOf(raw['@_media-type']) ?? '',
      properties: textOf(raw['@_properties']) ?? '',
    });
  }

  const spineNode = (pkg.spine ?? pkg['opf:spine']) as XmlNode | undefined;
  const spineIds = asArray(spineNode?.itemref as XmlNode | XmlNode[] | undefined)
    .map((r) => textOf(r['@_idref']))
    .filter((v): v is string => Boolean(v));
  if (spineIds.length === 0) throw unsupported('EPUB 结构无效（spine 为空）');

  // Cover: manifest properties="cover-image", else <meta name="cover" content=id>.
  let coverBuffer: { data: Buffer; ext: string } | null = null;
  let coverItem =
    Array.from(manifest.values()).find((i) => i.properties.split(/\s+/).includes('cover-image')) ??
    null;
  if (!coverItem) {
    const coverId = asArray(metadata.meta as XmlNode | XmlNode[] | undefined)
      .map((m) => (textOf(m['@_name']) === 'cover' ? textOf(m['@_content']) : null))
      .find((v): v is string => Boolean(v));
    if (coverId) coverItem = manifest.get(coverId) ?? null;
  }
  if (coverItem) {
    const path = resolveZipPath(opfDir, coverItem.href);
    const ext = extFor(path, coverItem.mediaType);
    if (ext) {
      const data = await zipBuffer(zip, path, MAX_IMAGE_BYTES);
      if (data && data.length > 0) {
        coverBuffer = { data, ext };
      }
    }
  }

  // Chapter titles: EPUB3 nav first, toc.ncx as fallback.
  const titles = new Map<string, string>();
  const navItem = Array.from(manifest.values()).find((i) =>
    i.properties.split(/\s+/).includes('nav'),
  );
  if (navItem) {
    const navPath = resolveZipPath(opfDir, navItem.href);
    const navHtml = await zipText(zip, navPath);
    if (navHtml) {
      for (const [k, v] of navTitleMap(navHtml, zipDirname(navPath))) titles.set(k, v);
    }
  }
  const ncxId = textOf(spineNode?.['@_toc']);
  const ncxItem =
    (ncxId ? manifest.get(ncxId) : undefined) ??
    Array.from(manifest.values()).find((i) => i.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxPath = resolveZipPath(opfDir, ncxItem.href);
    const ncxXml = await zipText(zip, ncxPath);
    if (ncxXml) {
      for (const [k, v] of ncxTitleMap(ncxXml, zipDirname(ncxPath))) {
        if (!titles.has(k)) titles.set(k, v);
      }
    }
  }

  // Re-host embedded images (dedup by zip path, capped per book).
  const imageUrlByPath = new Map<string, string | null>();
  let imagesSaved = 0;
  const rewriteImages = async (bodyHtml: string, itemDir: string): Promise<string> => {
    const srcs = new Set<string>();
    const re = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bodyHtml)) !== null) {
      const src = m[1];
      if (!/^(https?:|data:)/i.test(src)) srcs.add(src);
    }
    let html = bodyHtml;
    for (const src of srcs) {
      const zipPath = resolveZipPath(itemDir, src);
      if (!zipPath) continue;
      if (!imageUrlByPath.has(zipPath)) {
        let url: string | null = null;
        const ext = extFor(zipPath);
        if (ext && imagesSaved < MAX_IMAGES_PER_BOOK) {
          const data = await zipBuffer(zip, zipPath, MAX_IMAGE_BYTES);
          if (data && data.length > 0) {
            url = await saveImage(data, ext).catch(() => null);
            if (url) imagesSaved++;
          }
        }
        imageUrlByPath.set(zipPath, url);
      }
      const url = imageUrlByPath.get(zipPath);
      if (url) {
        html = html.split(`src="${src}"`).join(`src="${url}"`);
        html = html.split(`src='${src}'`).join(`src="${url}"`);
      }
    }
    return html;
  };

  const chapters: ExtractedChapter[] = [];
  let totalTextChars = 0;
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) continue;
    const mediaType = item.mediaType.toLowerCase();
    if (mediaType && mediaType !== 'application/xhtml+xml' && mediaType !== 'text/html') continue;

    const path = resolveZipPath(opfDir, item.href);
    const raw = await zipText(zip, path);
    if (!raw) continue;

    const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : raw;
    const rewritten = await rewriteImages(bodyHtml, zipDirname(path));
    const html = sanitizeChapterHtml(rewritten, { baseUrl: null });
    const text = htmlToPlainText(html);

    totalTextChars += text.length;
    if (totalTextChars > MAX_TOTAL_TEXT_CHARS) {
      throw unsupported('EPUB 文本内容过大，无法导入');
    }

    // Skip covers / blank filler pages.
    if (text.length < MIN_CHAPTER_TEXT_CHARS && !/<img/i.test(html)) continue;

    const chapterTitle = titles.get(path) ?? firstHeadingText(html) ?? `第 ${chapters.length + 1} 章`;
    chapters.push({ title: chapterTitle, html, text });
  }

  if (chapters.length === 0) throw unsupported('未能从 EPUB 中提取任何章节内容');

  const allText = chapters.map((c) => c.text).join('\n\n');
  const language = dcLanguage.startsWith('zh')
    ? 'zh'
    : dcLanguage.startsWith('en')
      ? 'en'
      : detectLanguage(allText);

  return {
    title,
    author,
    language,
    siteName: null,
    publishedAt,
    coverRemoteUrl: null,
    coverBuffer,
    chapters,
  };
}
