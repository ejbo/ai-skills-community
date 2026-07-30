import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  deleteLibraryFile,
  libraryPublicUrl,
  newLibraryKey,
  saveLibraryStream,
} from '@/lib/library/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const MAX_COVER_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const LIBRARY_FILE_PREFIX = '/api/library/file/';

async function loadEditableDoc(id: string, userId: string, isAdmin: boolean) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, uploaderId: true, coverUrl: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return { error: 404 as const };
  if (doc.uploaderId !== userId && !isAdmin) return { error: 403 as const };
  return { doc };
}

function deleteOldCover(coverUrl: string | null): void {
  // Only reap covers we host ourselves; external/og URLs have no local file.
  if (coverUrl?.startsWith(LIBRARY_FILE_PREFIX)) {
    void deleteLibraryFile(coverUrl.slice(LIBRARY_FILE_PREFIX.length)).catch(() => undefined);
  }
}

// POST /api/library/docs/[id]/cover (uploader/admin) — raw-body image upload
// replacing the doc's cover.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:cover:${session.user.id}`, 20, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const found = await loadEditableDoc(params.id, session.user.id, session.user.isAdmin);
  if ('error' in found) {
    return NextResponse.json(
      { error: found.error === 404 ? 'not_found' : 'forbidden' },
      { status: found.error },
    );
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: 'unsupported_type', reason: '仅支持 JPG / PNG / WebP / GIF 图片' },
      { status: 415 },
    );
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newLibraryKey('cover', ext);
  try {
    await saveLibraryStream(key, req.body, MAX_COVER_UPLOAD_BYTES);
  } catch (e) {
    if (e instanceof Error && e.message === 'file_too_large') {
      return NextResponse.json({ error: 'file_too_large', reason: '封面图不能超过 10MB' }, { status: 413 });
    }
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  const coverUrl = libraryPublicUrl(key);
  deleteOldCover(found.doc.coverUrl);
  await prisma.libraryDoc.update({ where: { id: found.doc.id }, data: { coverUrl } });
  return NextResponse.json({ ok: true, coverUrl });
}

// DELETE — remove the custom cover (falls back to the deterministic placeholder).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const found = await loadEditableDoc(params.id, session.user.id, session.user.isAdmin);
  if ('error' in found) {
    return NextResponse.json(
      { error: found.error === 404 ? 'not_found' : 'forbidden' },
      { status: found.error },
    );
  }

  deleteOldCover(found.doc.coverUrl);
  await prisma.libraryDoc.update({ where: { id: found.doc.id }, data: { coverUrl: null } });
  return NextResponse.json({ ok: true });
}
