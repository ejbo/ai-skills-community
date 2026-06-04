import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  extFor,
  isAllowedImageType,
  isAllowedVideoType,
  newVideoKey,
  saveVideoStream,
  videoPublicUrl,
} from '@/lib/video/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generous safety caps (NOT a limit on normal videos) — tune to your disk budget.
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

// POST /api/videos/upload (admin) — direct, self-hosted upload. The browser
// sends the raw file as the request body; we stream it to local disk. Headers:
//   content-type:   the file's MIME type
//   x-upload-kind:  'source' (video) | 'poster' (image)
//   x-filename:     encodeURIComponent(file.name)  (only used for extension fallback)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const kind = req.headers.get('x-upload-kind') === 'poster' ? 'poster' : 'source';
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  const filename = decodeURIComponent(req.headers.get('x-filename') ?? '');

  if (kind === 'source' && !isAllowedVideoType(contentType)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }
  if (kind === 'poster' && !isAllowedImageType(contentType)) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newVideoKey(kind, extFor(kind, contentType, filename));
  const max = kind === 'source' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  try {
    const size = await saveVideoStream(key, req.body, max);
    return NextResponse.json({ key, url: videoPublicUrl(key), size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
