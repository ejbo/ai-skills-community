// 知识库 file storage — LOCAL DISK adapter mirroring lib/uploads/post-media-storage.ts.
// Original PDF/EPUB uploads, downloaded covers and EPUB-internal images live
// under LOCAL_STORAGE_DIR/library/<kind>/<nanoid>.<ext>; bytes stream back
// through GET /api/library/file/[...key] (login + unguessable key, Range).
// NOTE: reads LOCAL_STORAGE_DIR from process.env directly (like the sibling
// storage modules) so tests can import this without a fully valid lib/env.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { nanoid } from 'nanoid';

const LIBRARY_ROOT = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_DIR || './storage',
  'library',
);

export const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_EPUB_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB

export type LibraryFileKind = 'original' | 'cover' | 'image';

// Extensions we will ever write/serve — a bogus filename can never make us
// store an arbitrary (e.g. .svg) extension. .html originals are stored but the
// file route serves them as text/plain (never renderable — stored user HTML
// executing on our origin would be XSS).
const ALLOWED_EXT = new Set(['pdf', 'epub', 'html', 'pptx', 'docx', 'jpg', 'jpeg', 'png', 'webp', 'gif']);

export type LibraryUploadFormat = 'pdf' | 'epub' | 'html' | 'pptx' | 'docx';

/** Doc format from MIME (octet-stream falls back to the filename ext). */
export function detectLibraryFormat(mime: string, filename: string): LibraryUploadFormat | null {
  const type = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  if (type === 'application/epub+zip') return 'epub';
  if (type === 'text/html') return 'html';
  if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  const m = (filename ?? '').match(/\.([a-zA-Z0-9]{1,5})$/);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'docx') return 'docx';
  return null;
}

/** A fresh unguessable storage key, e.g. "original/V1StGXR8.pdf". */
export function newLibraryKey(kind: LibraryFileKind, ext: string): string {
  const clean = (ext ?? '').replace(/^\./, '').toLowerCase();
  const safe = ALLOWED_EXT.has(clean) ? clean : kind === 'original' ? 'pdf' : 'jpg';
  return `${kind}/${nanoid()}.${safe}`;
}

/** Absolute path for a key, guarding against path traversal (null if unsafe). */
export function libraryAbsPath(key: string): string | null {
  const full = path.resolve(LIBRARY_ROOT, key);
  if (full !== LIBRARY_ROOT && !full.startsWith(LIBRARY_ROOT + path.sep)) return null;
  return full;
}

/** Root-relative URL (basePath applied at render via withBasePath). */
export function libraryPublicUrl(key: string): string {
  return `/api/library/file/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function libraryContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    // Deliberately text/plain: rendering stored user HTML on our origin = XSS.
    html: 'text/plain; charset=utf-8',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Stream a web ReadableStream (the raw request body) to disk, enforcing a max
 * byte cap. Cleans up the partial file on error. Returns bytes written.
 */
export async function saveLibraryStream(
  key: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = libraryAbsPath(key);
  if (!full) throw new Error('invalid_key');
  await fsp.mkdir(path.dirname(full), { recursive: true });

  const ws = fs.createWriteStream(full);
  let written = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      if (written > maxBytes) throw new Error('file_too_large');
      if (!ws.write(value)) {
        await new Promise<void>((resolve) => ws.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) =>
      ws.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
    return written;
  } catch (e) {
    ws.destroy();
    await fsp.unlink(full).catch(() => undefined);
    throw e;
  }
}

export async function saveLibraryBuffer(key: string, buf: Buffer): Promise<void> {
  const full = libraryAbsPath(key);
  if (!full) throw new Error('invalid_key');
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buf);
}

export async function statLibraryFile(key: string): Promise<{ size: number } | null> {
  const full = libraryAbsPath(key);
  if (!full) return null;
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return null;
    return { size: st.size };
  } catch {
    return null;
  }
}

/** A web ReadableStream for a (possibly partial) byte range of a stored file. */
export function openLibraryRange(key: string, start?: number, end?: number): ReadableStream {
  const full = libraryAbsPath(key);
  if (!full) throw new Error('invalid_key');
  const stream = fs.createReadStream(full, {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  });
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

/** Best-effort delete — never throws. */
export async function deleteLibraryFile(key: string): Promise<void> {
  if (!key) return;
  const full = libraryAbsPath(key);
  if (!full) return;
  await fsp.unlink(full).catch(() => undefined);
}

export async function deleteLibraryDocFiles(keys: (string | null)[]): Promise<void> {
  for (const key of keys) {
    if (key) await deleteLibraryFile(key);
  }
}
