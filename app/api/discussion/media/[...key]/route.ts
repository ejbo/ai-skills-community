import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import {
  openPostMediaRange,
  postMediaContentType,
  postMediaXAccelUri,
  statPostMediaAsync,
} from '@/lib/uploads/post-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The stored original name is user input (arbitrary Unicode) and must never
// break the header: header values are ByteStrings, so any code point > U+00FF
// (e.g. a CJK filename — the common case here) would throw and 500 the route.
// Quoted filename= gets an ASCII-only fallback; the real UTF-8 name travels in
// RFC 5987 filename*= (percent-encoded, always ASCII).
function contentDispositionAttachment(raw: string | null, key: string): string {
  const fallback = key.split('/').pop() ?? 'attachment';
  // eslint-disable-next-line no-control-regex
  const cleaned = (raw ?? '').replace(/[\u0000-\u001f\u007f"\\/]+/g, ' ').trim();
  const ascii = cleaned.replace(/[^\u0020-\u007e]+/g, '').trim() || fallback;
  const utf8 = cleaned || fallback;
  // encodeURIComponent leaves '()!* unescaped, which RFC 5987 disallows.
  const encoded = encodeURIComponent(utf8).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// GET /api/discussion/media/[...key] (login) — streams a post attachment from
// local disk. Same access model as the video board: login + unguessable
// capability key. Videos and PDFs render inline (Range support for seeking /
// the browser's native PDF viewer); PPT/Word downloads as an attachment with
// the original filename passed via ?name= (display only, sanitized).
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

  const stat = await statPostMediaAsync(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });

  const { size } = stat;
  const contentType = postMediaContentType(key);
  const inline = contentType.startsWith('video/') || contentType === 'application/pdf';
  const disposition = inline
    ? 'inline'
    : contentDispositionAttachment(new URL(req.url).searchParams.get('name'), key);
  const baseHeaders = {
    'content-type': contentType,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': disposition,
  };

  // A 0-byte stored file must not reach createReadStream (end = -1 throws).
  if (size === 0) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...baseHeaders, 'content-length': '0' },
    });
  }

  // Offload the bytes to nginx (kernel sendfile) now that the request is
  // authorized — Node leaves the data path, so a 1 GB post video no longer
  // pumps through the single JS thread. nginx does Range/206/416 itself, so we
  // send NO content-length/content-range (ours would describe the whole file
  // and contradict a 206). baseHeaders — including the CJK-safe
  // content-disposition — ride through unchanged. Gated: without the internal
  // `/_postmedia/` location this serves empty bodies (see deploy conf).
  if (env.MEDIA_X_ACCEL_REDIRECT) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...baseHeaders, 'X-Accel-Redirect': postMediaXAccelUri(key) },
    });
  }

  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] ? Number.parseInt(m[1], 10) : 0;
    let end = m && m[2] ? Number.parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end > size - 1) end = size - 1;
    if (start > end || start >= size) {
      return new NextResponse('Range Not Satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      });
    }
    const stream = openPostMediaRange(key, start, end);
    if (!stream) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }

  const stream = openPostMediaRange(key, 0, size - 1);
  if (!stream) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      ...baseHeaders,
      'content-length': String(size),
      'accept-ranges': 'bytes',
    },
  });
}
