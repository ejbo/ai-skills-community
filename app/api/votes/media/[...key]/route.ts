import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth';
import { openVoteMediaRange, statVoteMediaAsync, voteMediaContentType } from '@/lib/votes/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/votes/media/[...key] (login) — streams a vote-entry image/video (or
// poster/cover) from local disk. Same access model as the video board: login +
// unguessable capability key; everything renders inline (Range support for
// video seeking).
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

  const stat = await statVoteMediaAsync(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });

  const { size } = stat;
  const contentType = voteMediaContentType(key);
  const baseHeaders = {
    'content-type': contentType,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
  };

  // A 0-byte stored file must not reach createReadStream (end = -1 throws).
  if (size === 0) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...baseHeaders, 'content-length': '0' },
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
    const stream = openVoteMediaRange(key, start, end);
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

  const stream = openVoteMediaRange(key, 0, size - 1);
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
