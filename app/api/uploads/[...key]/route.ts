import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { openImageFile, statImageFile } from '@/lib/uploads/image-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/uploads/[...key] (public) — serves an editor-uploaded image from local
// disk. Ungated on purpose so embedded images render in any context (incl.
// anonymous skill views); keys are unguessable (nanoid). Keys are content-unique,
// so the response is long-lived & immutable. `nosniff` + the image-only content
// type (extension comes from the upload allowlist) prevent HTML/JS being served
// from this path. Path traversal is guarded inside statImageFile/openImageFile.
export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  // Key segments come straight from the URL — a malformed %-escape must 404, not 500.
  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  const stat = statImageFile(key);
  if (!stat) return new NextResponse('Not found', { status: 404 });
  const stream = openImageFile(key);
  if (!stream) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'content-type': stat.contentType,
      'content-length': String(stat.size),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  });
}
