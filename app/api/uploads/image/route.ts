import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  MAX_IMAGE_BYTES,
  imageExtFor,
  imagePublicUrl,
  isAllowedImageType,
  newImageKey,
  saveImageStream,
} from '@/lib/uploads/image-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// Per-user cap on editor image uploads. Bounds disk-fill abuse; the per-request
// MAX_IMAGE_BYTES only bounds a single file. (rate-limit.ts is in-memory/
// single-process — fine here; use a shared limiter for multi-instance deploys.)
const UPLOADS_PER_MINUTE = 30;

// POST /api/uploads/image (any logged-in user) — direct, self-hosted image upload
// for the rich-text editor (skill overview, video description, comments/reviews).
// The browser sends the raw file as the request body; we stream it to local disk.
// Headers:
//   content-type:  the file's MIME type (validated against an image allowlist)
//   x-filename:    encodeURIComponent(file.name)  (extension fallback only)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`upload:image:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
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
  // Reject oversized uploads up front when the client declares Content-Length,
  // before streaming anything to disk. (The stream cap below is the real guard.)
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newImageKey(imageExtFor(contentType, filename));
  try {
    const size = await saveImageStream(key, req.body, MAX_IMAGE_BYTES);
    return NextResponse.json({ key, url: imagePublicUrl(key), size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
