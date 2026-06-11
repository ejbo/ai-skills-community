import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { openVideoRange, statVideoFile } from '@/lib/video/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/videos/file/[...key] (login) — streams a stored video/poster from
// local disk with HTTP Range support (seeking). The whole board is login-walled;
// keys are unguessable (nanoid), so login + capability-key is the access model.
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  const key = params.key.map(decodeURIComponent).join('/');
  const stat = statVideoFile(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });

  const { size, contentType } = stat;
  const range = req.headers.get('range');
  // Keys are fresh nanoids per upload, so content never changes under a key —
  // safe to let the browser cache aggressively (private: the board is login-walled).
  // Without this every page showing posters re-downloads them through this route.
  const cacheControl = 'private, max-age=31536000, immutable';

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
    const stream = openVideoRange(key, start, end);
    if (!stream) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 206,
      headers: {
        'content-type': contentType,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
      },
    });
  }

  const stream = openVideoRange(key, 0, size - 1);
  if (!stream) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(size),
      'accept-ranges': 'bytes',
      'cache-control': cacheControl,
    },
  });
}
