import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import {
  MAX_POST_FILE_BYTES,
  MAX_POST_VIDEO_BYTES,
  faststartRemuxPostMedia,
  isAllowedPostFileType,
  isAllowedPostVideoType,
  newPostMediaKey,
  postMediaExtFor,
  postMediaPublicUrl,
  savePostMediaStream,
} from '@/lib/uploads/post-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Per-user caps on post media uploads. Bounds disk-fill abuse; the per-request
// byte caps only bound a single file. (Like lib/rate-limit.ts these ledgers
// are in-memory/single-process — fine here; use a shared store for
// multi-instance deploys.)
const UPLOADS_PER_MINUTE = 6;
const BYTES_PER_DAY = 5 * 1024 * 1024 * 1024; // 5 GB / user / rolling day

const byteLedger = new Map<string, { resetAt: number; bytes: number }>();

/** Rolling per-user daily byte budget. Returns false when the budget is spent. */
function chargeBytes(userId: string, bytes: number): boolean {
  const now = Date.now();
  let entry = byteLedger.get(userId);
  if (!entry || entry.resetAt <= now) {
    entry = { resetAt: now + DAY_MS, bytes: 0 };
    byteLedger.set(userId, entry);
  }
  if (entry.bytes + bytes > BYTES_PER_DAY) return false;
  entry.bytes += bytes;
  return true;
}

function refundBytes(userId: string, bytes: number): void {
  const entry = byteLedger.get(userId);
  if (entry) entry.bytes = Math.max(0, entry.bytes - bytes);
}

// POST /api/discussion/upload (any logged-in user) — direct, self-hosted upload
// of a post attachment. The browser sends the raw file as the request body; we
// stream it to local disk. Headers:
//   content-type:   the file's MIME type (validated against a per-kind allowlist)
//   x-upload-kind:  'video' (inline-playable upload) | 'file' (pdf/ppt/word)
//   x-filename:     encodeURIComponent(file.name)  (extension fallback only)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`upload:post-media:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const kind = req.headers.get('x-upload-kind') === 'file' ? 'file' : 'video';
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // x-filename is only an extension hint; a malformed %-escape must not 500 the route.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  const allowed =
    kind === 'video' ? isAllowedPostVideoType(contentType) : isAllowedPostFileType(contentType);
  if (!allowed) {
    return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  }

  const max = kind === 'video' ? MAX_POST_VIDEO_BYTES : MAX_POST_FILE_BYTES;
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

  const key = newPostMediaKey(kind, postMediaExtFor(kind, contentType, filename));
  try {
    const size = await savePostMediaStream(key, req.body, max);
    refundBytes(session.user.id, reserved - size);
    // Relocate the MP4/MOV moov atom to the front so playback starts immediately
    // (best-effort; no-op without ffmpeg).
    if (kind === 'video') {
      await faststartRemuxPostMedia(key, size);
    }
    return NextResponse.json({ key, url: postMediaPublicUrl(key), size });
  } catch (e) {
    refundBytes(session.user.id, reserved);
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
