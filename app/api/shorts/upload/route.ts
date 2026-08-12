import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { apiReason } from '@/lib/api-errors';
import {
  deleteVideoFile,
  extFor,
  faststartRemux,
  isAllowedImageType,
  isAllowedVideoType,
  newVideoKey,
  saveVideoStream,
  videoPublicUrl,
} from '@/lib/video/storage';
import {
  MAX_SHORT_POSTER_BYTES,
  MAX_SHORT_VIDEO_BYTES,
  SHORT_BYTES_PER_DAY,
} from '@/lib/video/shorts-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UPLOADS_PER_MINUTE = 6;

// Per-user rolling daily byte budget for shorts uploads. In-memory /
// single-process like lib/rate-limit.ts — fine on the current single-instance
// deploys; move to a shared store for multi-instance. (Same pattern as
// /api/discussion/upload, separate ledger on purpose.)
const byteLedger = new Map<string, { resetAt: number; bytes: number }>();

function chargeBytes(userId: string, bytes: number): boolean {
  const now = Date.now();
  let entry = byteLedger.get(userId);
  if (!entry || entry.resetAt <= now) {
    entry = { resetAt: now + DAY_MS, bytes: 0 };
    byteLedger.set(userId, entry);
  }
  if (entry.bytes + bytes > SHORT_BYTES_PER_DAY) return false;
  entry.bytes += bytes;
  return true;
}

function refundBytes(userId: string, bytes: number): void {
  const entry = byteLedger.get(userId);
  if (entry) entry.bytes = Math.max(0, entry.bytes - bytes);
}

// POST /api/shorts/upload (any logged-in user) — direct, self-hosted upload of
// a short's source video or auto-captured poster frame. The browser sends the
// raw file as the request body (house protocol; XHR for progress). Headers:
//   content-type:   the file's MIME type (validated per-kind allowlist)
//   x-upload-kind:  'source' (the video) | 'poster' (captured frame image)
//   x-filename:     encodeURIComponent(file.name)  (extension fallback only)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`shorts:upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const kind = req.headers.get('x-upload-kind') === 'poster' ? 'poster' : 'source';
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // x-filename is only an extension hint; a malformed %-escape must not 500 the route.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  const allowed = kind === 'poster' ? isAllowedImageType(contentType) : isAllowedVideoType(contentType);
  if (!allowed) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  const max = kind === 'poster' ? MAX_SHORT_POSTER_BYTES : MAX_SHORT_VIDEO_BYTES;
  // Reject oversized uploads up front when the client declares Content-Length,
  // before streaming anything to disk. (The stream cap below is the real guard.)
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  // Reserve the worst case (declared size, else the per-kind max) against the
  // daily byte budget up front, then settle to the actual written size.
  const reserved = Number.isFinite(declared) && declared > 0 ? declared : max;
  if (!chargeBytes(session.user.id, reserved)) {
    return NextResponse.json(
      { error: 'quota_exceeded', reason: await apiReason('upload_quota') },
      { status: 429 },
    );
  }

  const key = newVideoKey(kind, extFor(kind, contentType, filename));
  try {
    const size = await saveVideoStream(key, req.body, max);
    if (size === 0) {
      // A 0-byte "upload" would store a servable-but-broken key — reject it.
      await deleteVideoFile(key);
      throw new Error('empty_body');
    }
    refundBytes(session.user.id, reserved - size);
    // Move the moov atom to the front so the feed can start playback before the
    // download ends (best-effort; no-op without ffmpeg).
    if (kind === 'source') {
      await faststartRemux(key, size);
    }
    return NextResponse.json({ key, url: videoPublicUrl(key), size });
  } catch (e) {
    refundBytes(session.user.id, reserved);
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
