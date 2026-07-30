import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { detectLibraryFormat, deleteLibraryFile, newLibraryKey, saveLibraryStream } from '@/lib/library/storage';
import { replaceDocFile } from '@/lib/library/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// POST /api/library/docs/[id]/replace (uploader/admin) — raw-body upload of a
// replacement PDF/EPUB; content is re-extracted from the new file.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:replace:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, slug: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.uploaderId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
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
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newLibraryKey('original', format);
  let size = 0;
  try {
    size = await saveLibraryStream(key, req.body, Number.POSITIVE_INFINITY);
  } catch {
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  try {
    await replaceDocFile({
      docId: doc.id,
      fileKey: key,
      format,
      mimeType: contentType || (format === 'pdf' ? 'application/pdf' : 'application/epub+zip'),
      sizeBytes: size,
    });
  } catch (e) {
    await deleteLibraryFile(key);
    console.error('[library] replace failed', e);
    return NextResponse.json({ error: 'replace_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, doc: { id: doc.id, slug: doc.slug } });
}
