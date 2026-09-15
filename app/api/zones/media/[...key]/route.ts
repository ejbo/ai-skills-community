import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { buildRangeResponse, mediaHeaders } from '@/lib/uploads/serve';
import { isValidZoneMediaKey, openZoneMediaRange, statZoneMediaAsync, zoneMediaXAccelUri } from '@/lib/zones/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/zones/media/[...key] — login-walled byte server for every zone
// media kind (cover/icon/image/video/file/poster/preview) with HTTP Range.
// Every header decision lives in lib/uploads/serve.ts and is decided by the
// KEY's extension: raster images, mp4/webm/mov, audio and PDF render inline
// (players / iframes); everything else — attachments are ANY file type now —
// downloads as a nosniff, CSP-sandboxed `attachment` whose filename is
// `?name=<display name>` with the key's extension forced onto it.
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!isValidZoneMediaKey(key)) return new NextResponse('Not found', { status: 404 });

  const stat = await statZoneMediaAsync(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });
  const { headers } = mediaHeaders(key, { name: new URL(req.url).searchParams.get('name') });

  // Offload the bytes to nginx (kernel sendfile) now that the request is
  // authorized — Node leaves the data path, so a 40 MB 附件 download no longer
  // occupies the single JS thread. nginx does Range/206/416 itself, so we send
  // NO content-length/content-range (ours would describe the whole file and
  // contradict a 206). Content-Type / Disposition / Cache-Control ride through;
  // nosniff, CSP and CORP do NOT survive the internal redirect, which is why the
  // `/_zonemedia/` location re-adds them (deploy conf). Gated: without that
  // internal location this serves empty bodies.
  if (env.MEDIA_X_ACCEL_REDIRECT && stat.size > 0) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...headers, 'X-Accel-Redirect': zoneMediaXAccelUri(key) },
    });
  }

  return buildRangeResponse({
    rangeHeader: req.headers.get('range'),
    size: stat.size,
    headers,
    open: (start, end) => {
      const stream = openZoneMediaRange(key, start, end);
      return stream ? (Readable.toWeb(stream) as ReadableStream<Uint8Array>) : null;
    },
  });
}
