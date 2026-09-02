import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import {
  deleteZoneMediaFile,
  faststartRemuxZoneMedia,
  isAllowedZoneFileType,
  isAllowedZoneImageType,
  isAllowedZoneVideoType,
  maxBytesForZoneKind,
  newZoneMediaKey,
  probeZoneImageSize,
  probeZoneVideoDurationSec,
  saveZoneMediaStream,
  zoneMediaExtFor,
  zoneMediaPublicUrl,
  type ZoneMediaKind,
} from '@/lib/zones/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const UPLOADS_PER_MINUTE = 30;

type UploadKind = Extract<ZoneMediaKind, 'image' | 'video' | 'file' | 'poster'>;

function parseKind(raw: string | null): UploadKind {
  // `poster` = a client-captured cover frame for a video attachment (image
  // rules, `poster/` key) — echoed back as AttachmentInput.posterKey.
  return raw === 'video' || raw === 'file' || raw === 'poster' ? raw : 'image';
}

// POST /api/zones/[slug]/attachments/upload (access.canPost || canModerate) — raw-body upload.
// Headers:
//   content-type:   file MIME (validated per kind)
//   x-upload-kind:  'image' | 'video' | 'file' | 'poster'
//   x-filename:     encodeURIComponent(file.name) — extension hint + display name
// → { key, url, size, width, height, kind, durationSec, name }
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:upload:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    // `retry-after` (seconds, ≥ 1) is what the editor's sequential upload queue
    // sleeps on before retrying the same file at the same position — the body
    // keeps `resetAt` for the toast. Counts are unlimited; this is the ONLY
    // upload throttle left, so it must be recoverable, not terminal.
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('zone_rate_limited_upload'), resetAt: gate.resetAt },
      { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000))) } },
    );
  }

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canPost && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_post_forbidden') }, { status: 403 });
  }

  const kind = parseKind(req.headers.get('x-upload-kind'));
  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // A malformed %-escape in x-filename must not 500.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }
  // eslint-disable-next-line no-control-regex
  const displayName = filename.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);

  const allowed =
    kind === 'video'
      ? isAllowedZoneVideoType(contentType)
      : kind === 'file'
        ? isAllowedZoneFileType(contentType, filename)
        : isAllowedZoneImageType(contentType);
  if (!allowed) {
    return NextResponse.json(
      { error: 'unsupported_type', reason: await apiReason('zone_unsupported_type') },
      { status: 415 },
    );
  }

  const max = maxBytesForZoneKind(kind);
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    return NextResponse.json(
      { error: 'file_too_large', reason: await apiReason('zone_file_too_large') },
      { status: 413 },
    );
  }
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newZoneMediaKey(kind, zoneMediaExtFor(kind, contentType, filename));
  let size = 0;
  try {
    size = await saveZoneMediaStream(key, req.body, max);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') {
      return NextResponse.json(
        { error: 'file_too_large', reason: await apiReason('zone_file_too_large') },
        { status: 413 },
      );
    }
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed', reason: await apiReason('zone_upload_failed') }, { status: 500 });
  }

  try {
    let width: number | null = null;
    let height: number | null = null;
    let durationSec: number | null = null;
    if (kind === 'video') {
      // Tail-`moov` files stall the first frame; remux is a no-op without ffmpeg.
      await faststartRemuxZoneMedia(key, size);
      durationSec = await probeZoneVideoDurationSec(key);
    } else if (kind === 'image' || kind === 'poster') {
      const dims = await probeZoneImageSize(key);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    }
    return NextResponse.json({
      key,
      url: zoneMediaPublicUrl(key),
      size,
      width,
      height,
      kind,
      durationSec,
      name: displayName,
    });
  } catch {
    // Post-processing failed after the bytes landed — don't leak an orphan file.
    await deleteZoneMediaFile(key);
    return NextResponse.json({ error: 'upload_failed', reason: await apiReason('zone_upload_failed') }, { status: 500 });
  }
}
