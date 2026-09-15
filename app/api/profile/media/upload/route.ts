import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { MAX_UPLOAD_SAFETY_BYTES, hasFreeSpace } from '@/lib/uploads/disk-space';
import { profileMediaUrl } from '@/lib/profile/shared';
import { sweepOwnUnattachedCardMedia } from '@/lib/profile/profile-store';
import {
  PROFILE_UPLOAD_IMAGE_TYPES,
  PROFILE_UPLOAD_VIDEO_TYPES,
  deleteProfileMediaFiles,
  isProfileUploadKind,
  makeProfileVideoDerivatives,
  newProfileMediaKey,
  ownerTagFor,
  probeProfileVideoDurationSec,
  profileMediaExtFor,
  profileUploadMaxBytes,
  saveProfileMediaStream,
  stripStoredImageMetadata,
} from '@/lib/profile/card-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// A card has ONE photo or video; even a member trying several looks uploads a
// handful a minute. Anything past this is disk-fill abuse, not indecision.
const UPLOADS_PER_MINUTE = 12;

// POST /api/profile/media/upload — raw-body upload of 名片 media (step 1 of 2;
// PUT /api/me/profile/media attaches the keys). Any logged-in member.
// Headers:
//   content-type   the file's MIME, allowlisted per kind:
//                    image / poster  image/jpeg image/png image/webp image/gif
//                    video           video/mp4 video/webm video/quicktime
//                  (no AVIF: its metadata cannot be stripped server-side; the
//                  settings UI re-encodes photos to WebP/JPEG first). A refusal
//                  is 400 { error: 'unsupported_type', accepted: [...] }.
//   x-upload-kind  image | video | poster   (poster = the client-captured first frame)
//   x-filename     encodeURIComponent(name) — extension hint only, never stored or echoed
//
// → { kind, key, url, size, posterKey, posterUrl, loopKey, loopUrl, durationSec }
// For a video the server also tries to cut the ≤ PROFILE_LOOP_SECONDS hover loop
// and a poster frame (best-effort: both null without ffmpeg — the client then
// uploads its own poster). A video's `url` is `loopUrl ?? posterUrl ?? null` —
// the original is never served, so it never gets a URL. Nothing is attached to
// the profile here, and nothing uploaded is served until PUT /api/me/profile/
// media attaches it, so an abandoned upload is an unreachable orphan file — which
// every upload request also reclaims, best-effort, for the CALLER's own leftovers
// older than 24 h (sweepOwnUnattachedCardMedia; bounded, throttled, never fails
// the upload).
//
// Every key carries the uploader's owner tag (card-media-storage.ts), which is
// what lets the attach step refuse anyone else's key. Photos and posters have
// their EXIF/XMP/IPTC stripped before the key is returned (orientation kept) —
// a card photo is shown to anonymous visitors, GPS included otherwise; bytes
// that are not a well-formed image are refused as unsupported_type.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`profile:card-upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: 'rate_limited', resetAt: gate.resetAt },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  }

  // Not awaited: reclaiming yesterday's abandoned files must not slow or fail this upload.
  void sweepOwnUnattachedCardMedia(session.user.id);

  const kind = req.headers.get('x-upload-kind');
  if (!isProfileUploadKind(kind)) return NextResponse.json({ error: 'bad_kind' }, { status: 400 });
  const unsupported = () =>
    NextResponse.json(
      { error: 'unsupported_type', accepted: kind === 'video' ? PROFILE_UPLOAD_VIDEO_TYPES : PROFILE_UPLOAD_IMAGE_TYPES },
      { status: 400 },
    );

  // x-filename is only an extension hint; a malformed %-escape must not 500.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }
  const ext = profileMediaExtFor(kind, req.headers.get('content-type') ?? '', filename);
  if (!ext) return unsupported();

  const max = Math.min(profileUploadMaxBytes(kind), MAX_UPLOAD_SAFETY_BYTES);
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (Number.isFinite(declared) && req.headers.has('content-length') && declared === 0) {
    return NextResponse.json({ error: 'empty' }, { status: 400 });
  }
  // PostgreSQL shares this volume — stop at the reserve rather than ENOSPC the DB.
  if (!(await hasFreeSpace(Number.isFinite(declared) ? declared : 0))) {
    return NextResponse.json({ error: 'disk_full' }, { status: 507 });
  }
  if (!req.body) return NextResponse.json({ error: 'empty' }, { status: 400 });

  const ownerTag = ownerTagFor(session.user.id);
  const key = newProfileMediaKey(kind, ext, ownerTag);
  let size = 0;
  try {
    size = await saveProfileMediaStream(key, req.body, max);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  let posterKey: string | null = null;
  let loopKey: string | null = null;
  let durationSec: number | null = null;
  try {
    if (kind === 'video') {
      const derived = await makeProfileVideoDerivatives(key, ownerTag);
      posterKey = derived.posterKey;
      loopKey = derived.loopKey;
      durationSec = await probeProfileVideoDurationSec(key);
    } else {
      const stripped = await stripStoredImageMetadata(key);
      if (stripped === null) {
        await deleteProfileMediaFiles([key]);
        return unsupported();
      }
      size = stripped;
    }
    const posterUrl = posterKey ? profileMediaUrl(posterKey) : null;
    const loopUrl = loopKey ? profileMediaUrl(loopKey) : null;
    return NextResponse.json({
      kind,
      key,
      url: kind === 'video' ? loopUrl ?? posterUrl : profileMediaUrl(key),
      size,
      posterKey,
      posterUrl,
      loopKey,
      loopUrl,
      durationSec,
    });
  } catch {
    // Every step above is best-effort and should not throw; if something still
    // does, leave nothing behind on the volume the database lives on.
    await deleteProfileMediaFiles([key, posterKey, loopKey]);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
