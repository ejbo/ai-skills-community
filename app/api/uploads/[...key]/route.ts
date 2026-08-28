import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { openImageFile, statImageFileAsync, uploadXAccelUri } from '@/lib/uploads/image-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/uploads/[...key] (public) — serves an editor-uploaded image from local
// disk. Ungated on purpose so embedded images render in any context (incl.
// anonymous skill views); keys are unguessable (nanoid). Keys are content-unique,
// so the response is long-lived & immutable. `nosniff` + the image-only content
// type (extension comes from the upload allowlist) prevent HTML/JS being served
// from this path. Path traversal is guarded inside statImageFileAsync/openImageFile.
export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  // Key segments come straight from the URL — a malformed %-escape must 404, not 500.
  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  // Async stat, not statSync: this is the highest-REQUEST media route (avatars,
  // 表情包 and editor images — a busy feed page fires dozens), and each blocking
  // statSync stalls the single JS thread for every other request in flight.
  const stat = await statImageFileAsync(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });

  const baseHeaders = {
    'content-type': stat.contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
  };

  // Hand the bytes to nginx (kernel sendfile) — the file is public, so there is
  // nothing to authorize, and Node is then out of the data path entirely. No
  // content-length: nginx sets it (and owns Range/206) from the file it serves.
  // Gated: without the internal `/_uploads/` location this serves empty bodies.
  if (env.MEDIA_X_ACCEL_REDIRECT) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...baseHeaders, 'X-Accel-Redirect': uploadXAccelUri(key) },
    });
  }

  const stream = openImageFile(key);
  if (!stream) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: { ...baseHeaders, 'content-length': String(stat.size) },
  });
}
