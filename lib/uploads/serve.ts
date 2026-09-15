// Shared byte-serving decisions for user-uploaded files: Content-Type,
// Content-Disposition, the security headers, and HTTP Range. The zone media
// route uses it today and the discussion media route is meant to (the two had
// drifting copies of the disposition helper and the inline rule). Pure — no
// env, no fs, no next/server — so every header decision is unit-tested in
// tests/uploads-serve.test.ts; `buildRangeResponse` returns a plain web
// `Response`, which route handlers may return as-is.
//
// The policy, and why each piece exists:
//   - Content-Type comes from the STORAGE KEY's extension (lib/files/file-types
//     `contentTypeFor`), never from the upload's claimed MIME or the display
//     name. Real types only for the inline media set; text-like files (html,
//     svg, xml, js…) are `text/plain`; the rest octet-stream.
//   - `X-Content-Type-Options: nosniff` on EVERY response — without it a browser
//     may sniff an octet-stream / text body into HTML.
//   - `inline` only for raster images, mp4/webm/mov, audio and PDF; everything
//     else is `attachment`, so a direct link downloads instead of rendering.
//   - The download branch additionally gets `Content-Security-Policy: sandbox`
//     (should anything ever render the body as a document, it runs in an opaque
//     origin with no script) and `Cross-Origin-Resource-Policy: same-origin`
//     (no other site can embed the bytes). NEVER on PDF: Chromium refuses to
//     render a PDF inside a sandboxed document, which would blank every inline
//     PDF iframe.
//   - The filename in Content-Disposition is CJK-safe (ASCII fallback +
//     RFC 5987 UTF-8) and its extension is FORCED to the key's: the display
//     name rides in `?name=`, which whoever builds the link controls, so a
//     `.txt` key must not be deliverable as `run.bat`.
//   - X-Accel-Redirect (nginx sendfile) drops app headers that are not in
//     nginx's redirect table — nosniff / CSP / CORP among them — so
//     deploy/ai-community.nginx.conf re-adds them per extension in the internal
//     media locations. Keep the extension sets there in agreement with
//     file-types (tests/uploads-serve.test.ts reads the conf and checks).

import { FALLBACK_KEY_EXT, contentTypeFor, keyExtOf, lastExtOfName, serveClassOf, type ServeClass } from '@/lib/files/file-types';

export interface MediaHeaderOptions {
  /** Display name from `?name=` (untrusted). Only a download's filename uses it. */
  name?: string | null;
  cacheControl?: string;
}

const DEFAULT_CACHE = 'private, max-age=31536000, immutable';

/** `jpg` and `jpeg` are one format — a `photo.jpeg` served from a `.jpg` key needs no second suffix. */
const EXT_ALIASES: Readonly<Record<string, string>> = { jpeg: 'jpg', tiff: 'tif', htm: 'html', yml: 'yaml' };
const canonicalExt = (ext: string) => EXT_ALIASES[ext] ?? ext;

/**
 * The filename a response may carry: the cleaned display name with its
 * extension forced to the key's. A matching extension is kept as typed; a
 * different one gets the key's APPENDED (`run.bat` on a `.txt` key →
 * `run.bat.txt` — the last suffix is the one an OS acts on, and nothing the
 * user typed is lost). A `bin` key (the name had no usable extension) keeps an
 * extension-less name as-is. Empty / unusable names fall back to the key's
 * basename.
 */
export function safeDownloadName(rawName: string | null | undefined, key: string): string {
  const keyBase = key.split('/').pop() || 'attachment';
  const keyExt = keyExtOf(key);
  // eslint-disable-next-line no-control-regex
  const cleaned = (rawName ?? '').replace(/[\u0000-\u001f\u007f"\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  // A name that is only dots / spaces would be a hidden or empty file on disk.
  if (!cleaned || /^[.\s]+$/.test(cleaned)) return keyBase;
  if (!keyExt) return cleaned;
  const nameExt = lastExtOfName(cleaned);
  if (nameExt && canonicalExt(nameExt) === canonicalExt(keyExt)) return cleaned;
  if (keyExt === FALLBACK_KEY_EXT && !nameExt) return cleaned;
  return `${cleaned}.${keyExt}`;
}

/** `inline` or `attachment` with an ASCII fallback `filename=` and the RFC 5987 UTF-8 `filename*=`. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  // Header values are ByteStrings: a raw CJK name would throw and 500 the route.
  const ascii = filename.replace(/[^\u0020-\u007e]+/g, '').replace(/["\\]/g, '').trim() || 'download';
  // encodeURIComponent leaves '()!* unescaped, which RFC 5987 disallows.
  const encoded = encodeURIComponent(filename).replace(/['()!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface MediaHeaderDecision {
  serveClass: ServeClass;
  headers: Record<string, string>;
}

/** Every header a stored file's response carries except length / range. */
export function mediaHeaders(key: string, opts: MediaHeaderOptions = {}): MediaHeaderDecision {
  const ext = keyExtOf(key);
  const serveClass = serveClassOf(ext);
  const filename = safeDownloadName(opts.name, key);
  const headers: Record<string, string> = {
    'content-type': contentTypeFor(ext),
    'cache-control': opts.cacheControl ?? DEFAULT_CACHE,
    'x-content-type-options': 'nosniff',
  };
  if (serveClass === 'download') {
    headers['content-disposition'] = contentDisposition('attachment', filename);
    headers['content-security-policy'] = 'sandbox';
    headers['cross-origin-resource-policy'] = 'same-origin';
  } else {
    // Inline media keeps a filename so the browser's own "save" uses the real name.
    headers['content-disposition'] = contentDisposition('inline', filename);
  }
  return { serveClass, headers };
}

export type RangeDecision = { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' };

/**
 * One `bytes=` range against a file of `size` bytes (RFC 9110 §14.1.2):
 * `a-b`, open-ended `a-`, and suffix `-n` (the last n bytes). A header that is
 * absent, malformed or multi-range is ignored (`full` — a 200 is always a valid
 * answer); a start past the end is `unsatisfiable` (416).
 */
export function parseByteRange(header: string | null | undefined, size: number): RangeDecision {
  if (!header) return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  if (m[1] === '') {
    const suffix = Number.parseInt(m[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number.parseInt(m[1], 10);
  let end = m[2] === '' ? size - 1 : Number.parseInt(m[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'full' };
  if (end > size - 1) end = size - 1;
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}

export interface RangeResponseInput {
  rangeHeader: string | null;
  size: number;
  headers: Record<string, string>;
  /** Opens a byte stream for [start, end] inclusive; null ⇒ 404. */
  open: (start: number, end: number) => ReadableStream<Uint8Array> | null;
}

/** 200 / 206 / 416 for a stored file, with Accept-Ranges. Headers from `mediaHeaders` ride on every status. */
export function buildRangeResponse({ rangeHeader, size, headers, open }: RangeResponseInput): Response {
  if (size === 0) {
    return new Response(null, { status: 200, headers: { ...headers, 'content-length': '0', 'accept-ranges': 'bytes' } });
  }
  const range = parseByteRange(rangeHeader, size);
  if (range.kind === 'unsatisfiable') {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${size}`, 'x-content-type-options': 'nosniff' },
    });
  }
  const start = range.kind === 'partial' ? range.start : 0;
  const end = range.kind === 'partial' ? range.end : size - 1;
  const body = open(start, end);
  if (!body) return new Response('Not found', { status: 404 });
  if (range.kind === 'partial') {
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }
  return new Response(body, { status: 200, headers: { ...headers, 'content-length': String(size), 'accept-ranges': 'bytes' } });
}
