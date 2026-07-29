import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { libraryContentType, openLibraryRange, statLibraryFile } from '@/lib/library/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/library/file/[...key] (login) — streams a stored original PDF/EPUB,
// cover or EPUB-internal image from local disk with HTTP Range support. Keys are
// unguessable (nanoid), so login + capability-key is the access model — same as
// the video board.
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  // A malformed %-escape must not 500 the route.
  let key = '';
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const stat = await statLibraryFile(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });

  const { size } = stat;
  const contentType = libraryContentType(key);
  // Keys are fresh nanoids per upload — content never changes under a key, so
  // the browser may cache aggressively (private: files are login-walled).
  const baseHeaders: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'private, max-age=31536000, immutable',
  };
  if (contentType === 'application/pdf') {
    const basename = key.split('/').pop() ?? 'document.pdf';
    baseHeaders['content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(basename)}`;
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
    return new NextResponse(openLibraryRange(key, start, end), {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }

  return new NextResponse(openLibraryRange(key, 0, size - 1), {
    status: 200,
    headers: {
      ...baseHeaders,
      'content-length': String(size),
      'accept-ranges': 'bytes',
    },
  });
}
