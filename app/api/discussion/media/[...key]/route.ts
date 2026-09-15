import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { buildRangeResponse, mediaHeaders } from '@/lib/uploads/serve';
import {
  isValidPostMediaKey,
  openPostMediaRange,
  postMediaXAccelUri,
  statPostMediaAsync,
} from '@/lib/uploads/post-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/discussion/media/[...key] (login) — streams a 讨论区 attachment from
// local disk. Same access model as the video board: login + unguessable
// capability key. Every header decision is lib/uploads/serve.ts's, made from the
// KEY's extension (the same policy as the 技术专区 media route): mp4/webm/mov,
// raster images, audio and PDF render inline (player / the browser's PDF
// viewer); everything else — attachments are ANY file type now — downloads as a
// nosniff, CSP-sandboxed `attachment` whose filename is `?name=<display name>`
// (CJK-safe) with the key's extension forced onto it, so a `.py` key can never
// be handed out as `run.bat`.
//
// The key is SHAPE-checked before touching the disk: only `video/<id>.<ext>` and
// `file/<id>.<ext>` exist here. Without it every byte under post-media/ was
// servable — including the `<key>.tmp.mp4` a faststart remux writes mid-flight.
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  // Key segments come straight from the URL — a malformed %-escape must 404, not 500.
  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!isValidPostMediaKey(key)) return new NextResponse('Not found', { status: 404 });

  const stat = await statPostMediaAsync(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });
  const { headers } = mediaHeaders(key, { name: new URL(req.url).searchParams.get('name') });

  // Offload the bytes to nginx (kernel sendfile) now that the request is
  // authorized — Node leaves the data path, so a 1 GB post video no longer
  // pumps through the single JS thread. nginx does Range/206/416 itself, so we
  // send NO content-length/content-range (ours would describe the whole file
  // and contradict a 206). Content-Type / Disposition / Cache-Control ride
  // through; nosniff, CSP and CORP do NOT survive the internal redirect, which
  // is why the `/_postmedia/` location re-adds them per extension (deploy conf).
  // Gated: without that internal location this serves empty bodies. A 0-byte
  // file is answered here (nginx would 416 a Range against it).
  if (env.MEDIA_X_ACCEL_REDIRECT && stat.size > 0) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...headers, 'X-Accel-Redirect': postMediaXAccelUri(key) },
    });
  }

  return buildRangeResponse({
    rangeHeader: req.headers.get('range'),
    size: stat.size,
    headers,
    open: (start, end) => {
      const stream = openPostMediaRange(key, start, end);
      return stream ? (Readable.toWeb(stream) as ReadableStream<Uint8Array>) : null;
    },
  });
}
