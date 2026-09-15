import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  isPublicUploadKey,
  openImageFileBody,
  statImageFileAsync,
  uploadXAccelUri,
  type ImageFileStat,
} from '@/lib/uploads/image-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET|HEAD /api/uploads/[...key] (public) — serves an editor-uploaded image from
// local disk (avatars, banners, 表情包, editor images). Ungated on purpose so
// embedded images render in any context (incl. anonymous skill views); keys are
// unguessable (nanoid). Keys are content-unique, so the response is long-lived &
// immutable. `nosniff` + the image-only content type (extension comes from the
// upload allowlist) prevent HTML/JS being served from this path. Path traversal
// is guarded inside isPublicUploadKey / statImageFileAsync.
//
// `profile-card/` (名片 media) shares this disk root but is NEVER served here:
// /api/profile/media/[...key] is its only public path, because that route checks
// the file is attached to an active member's card and never serves a video
// original. See GATED_UPLOAD_NAMESPACES.
//
// HEAD is explicit and only stats: Next's auto-HEAD runs GET and drops the body
// without cancelling it, and GET bodies open their file lazily (on first read)
// for the same reason — an fd opened for a body nobody reads was never closed,
// so every anonymous `curl -I` pinned one until the process hit EMFILE.

type Found = { key: string; stat: ImageFileStat };

async function resolvePublic(params: { key: string[] }): Promise<Found | null> {
  // Key segments come straight from the URL — a malformed %-escape must 404, not 500.
  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  if (!isPublicUploadKey(key)) return null;
  // Async stat, not statSync: this is the highest-REQUEST media route (avatars,
  // 表情包 and editor images — a busy feed page fires dozens), and each blocking
  // statSync stalls the single JS thread for every other request in flight.
  const stat = await statImageFileAsync(key);
  return stat ? { key, stat } : null;
}

function baseHeaders(stat: ImageFileStat): Record<string, string> {
  return {
    'content-type': stat.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
  };
}

/**
 * Hand the bytes to nginx (kernel sendfile) — the file is public, so there is
 * nothing to authorize, and Node is then out of the data path entirely. No
 * content-length: nginx sets it (and owns Range/206) from the file it serves.
 * Gated: without the internal `/_uploads/` location this serves empty bodies.
 */
function accelResponse({ key, stat }: Found): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: { ...baseHeaders(stat), 'X-Accel-Redirect': uploadXAccelUri(key) },
  });
}

export async function HEAD(_req: Request, { params }: { params: { key: string[] } }) {
  const found = await resolvePublic(params);
  if (!found) return new NextResponse(null, { status: 404 });
  if (env.MEDIA_X_ACCEL_REDIRECT) return accelResponse(found);
  return new NextResponse(null, {
    status: 200,
    headers: { ...baseHeaders(found.stat), 'content-length': String(found.stat.size) },
  });
}

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const found = await resolvePublic(params);
  if (!found) return new NextResponse('Not found', { status: 404 });
  if (env.MEDIA_X_ACCEL_REDIRECT) return accelResponse(found);

  const { key, stat } = found;
  const headers = { ...baseHeaders(stat), 'content-length': String(stat.size) };
  if (stat.size === 0) return new NextResponse(null, { status: 200, headers });

  const body = openImageFileBody(key, stat.size);
  if (!body) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(body, { status: 200, headers });
}
