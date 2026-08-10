import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import {
  MAX_IMAGE_BYTES,
  deleteImageFile,
  imageExtFor,
  isAllowedImageType,
  newStickerKey,
  saveImageStream,
} from '@/lib/uploads/image-storage';
import { MAX_STICKERS_PER_USER } from '@/lib/stickers';
import { toStickerDto } from '@/lib/sticker-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const UPLOADS_PER_MINUTE = 30;

// POST /api/stickers/upload — add ONE sticker file (image/GIF) to the viewer's
// library. Same raw-body protocol as /api/uploads/image (headers content-type +
// x-filename); the client loops for multi-file picks, house style. GIFs are
// stored verbatim (no re-encode), so animation survives.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`upload:sticker:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // x-filename is only an extension hint; a malformed %-escape must not 500 the route.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  if (!isAllowedImageType(contentType)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  // Approximate cap — a burst of parallel uploads may overshoot by a few; fine.
  const count = await prisma.userSticker.count({ where: { userId: session.user.id } });
  if (count >= MAX_STICKERS_PER_USER) {
    return NextResponse.json({ error: 'sticker_limit' }, { status: 400 });
  }

  const key = newStickerKey(imageExtFor(contentType, filename));
  try {
    const size = await saveImageStream(key, req.body, MAX_IMAGE_BYTES);
    if (size === 0) {
      // saveImageStream doesn't reject empty bodies (post-media does) — a 0-byte
      // sticker would render broken forever, so clean it up here.
      await deleteImageFile(key);
      return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    }
    const row = await prisma.userSticker.create({
      data: { userId: session.user.id, fileKey: key },
    });
    return NextResponse.json({ ok: true, sticker: toStickerDto(row) });
  } catch (e) {
    // Don't leave an orphaned file if the stream cap or the DB write failed.
    await deleteImageFile(key);
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
