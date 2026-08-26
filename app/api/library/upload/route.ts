import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isDocType } from '@/lib/library/types';
import { cleanCategoriesFromDb } from '@/lib/library/categories';
import {
  detectLibraryFormat,
  deleteLibraryFile,
  libraryContentType,
  newLibraryKey,
  saveLibraryStream,
} from '@/lib/library/storage';
import { createDocFromFile, IngestError } from '@/lib/library/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const INGEST_STATUS: Record<string, number> = {
  invalid_url: 400,
  fetch_failed: 502,
  too_large: 413,
  unsupported_content: 415,
};

// POST /api/library/upload (login) — raw-body PDF/EPUB upload for the 知识库.
// The browser sends the file bytes as the request body; metadata in headers:
//   content-type:  the file's MIME type
//   x-filename:    encodeURIComponent(file.name)  (extension fallback + title hint)
//   x-doc-type:    optional explicit 类型 (falls back to auto)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:upload:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '上传过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // x-filename is only a hint; a malformed %-escape must not 500 the route.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  const format = detectLibraryFormat(contentType, filename);
  if (!format) {
    return NextResponse.json(
      { error: 'unsupported_type', reason: '仅支持 PDF / EPUB / HTML / PPTX / DOCX 文件' },
      { status: 415 },
    );
  }

  // No upload size cap by design (product decision) — the save is streamed to
  // disk so large files never sit in memory.
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const docTypeHeader = req.headers.get('x-doc-type') ?? '';
  const docType = isDocType(docTypeHeader) ? docTypeHeader : 'auto';
  let categories: string[] = [];
  try {
    categories = await cleanCategoriesFromDb(JSON.parse(req.headers.get('x-categories') ?? '[]'));
  } catch {
    categories = [];
  }

  const key = newLibraryKey('original', format);
  let size = 0;
  try {
    size = await saveLibraryStream(key, req.body, Number.POSITIVE_INFINITY);
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  try {
    const result = await createDocFromFile({
      fileKey: key,
      format,
      filename,
      mimeType: contentType || libraryContentType(key),
      sizeBytes: size,
      uploaderId: session.user.id,
      docType,
      categories,
    });
    return NextResponse.json({
      ok: true,
      doc: { id: result.id, slug: result.slug, status: result.status },
      existing: result.existing,
    });
  } catch (e) {
    // A throw means no doc row owns the stored file — don't leak it on disk.
    // (Extraction failures are recorded on the row inside ingest, not thrown;
    // content-hash dedup deletes the fresh file itself and returns existing.)
    await deleteLibraryFile(key);
    if (e instanceof IngestError) {
      return NextResponse.json(
        { error: e.code, reason: e.message },
        { status: INGEST_STATUS[e.code] ?? 400 },
      );
    }
    console.error('[library] file ingest failed', e);
    return NextResponse.json({ error: 'ingest_failed' }, { status: 500 });
  }
}
