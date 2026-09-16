import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import {
  openProfileMediaBody,
  parseByteRange,
  profileMediaContentType,
  profileMediaXAccelUri,
  resolveOwnProfileSource,
} from '@/lib/profile/card-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET|HEAD /api/me/profile/media/source?key=<videoKey> — OWNER-ONLY byte server
// for an uploaded 名片 video ORIGINAL, so the card editor's trimmer can re-cut a
// saved card video (OwnProfileSettings.sourceUrl) or play a fresh upload.
//
// The original is never public (the public /api/profile/media/[...key] 404s every
// `video/` key): it has the full length, the audio and the phone's container
// metadata. Here it is served only to a signed-in caller whose owner tag the key
// carries, and only while the file is on disk — attached or a fresh upload of
// theirs. Everyone else gets 404, never 403, so the route never confirms that a
// key exists. No session ⇒ 401 (which says nothing about the key either).
//
// `private, max-age=600` + `Vary: Cookie` on the bytes: `private` keeps them out of every shared
// cache, and the max-age lets the trimmer's preview <video> and its filmstrip
// decoder share ONE download of the original instead of each fetching the whole
// file (a 200 MB original was ~400 MB per 剪辑片段 under `no-store`). Safe to
// cache because a key's content never changes (a new upload is a new key) and
// the key is an unguessable, owner-tagged capability; the owner check still runs
// on every request that reaches the server. The window is short and varies on
// the session cookie so a signed-out (or switched) browser profile cannot keep
// replaying a deleted original from cache for long. Refusals (401/404) and 416 stay
// `no-store`, so a later login or a fresh upload is never answered from cache.
// Range/206/416 as on the public route (a <video> will not seek without it), and
// HEAD is explicit and never opens the file (Next's auto-HEAD runs GET and drops
// an unread body — the fd leak openLazyFileBody exists for).

const NO_STORE = 'private, no-store';
const PRIVATE_CACHE = 'private, max-age=600';

async function resolve(req: Request): Promise<{ key: string; size: number } | 401 | 404> {
  const session = await auth();
  if (!session?.user) return 401;
  const key = new URL(req.url).searchParams.get('key');
  const found = await resolveOwnProfileSource(session.user.id, key);
  return found ?? 404;
}

function baseHeaders(key: string): Record<string, string> {
  return {
    'content-type': profileMediaContentType(key),
    'cache-control': PRIVATE_CACHE,
    vary: 'Cookie',
    'x-content-type-options': 'nosniff',
    // Never a filename: nothing user-supplied reaches a header.
    'content-disposition': 'inline',
  };
}

function refuse(status: 401 | 404, withBody: boolean) {
  const headers = { 'cache-control': NO_STORE };
  if (!withBody) return new NextResponse(null, { status, headers });
  return status === 401
    ? NextResponse.json({ error: 'unauthenticated' }, { status, headers })
    : new NextResponse('Not found', { status, headers });
}

export async function HEAD(req: Request) {
  const found = await resolve(req);
  if (typeof found === 'number') return refuse(found, false);
  const headers = baseHeaders(found.key);
  if (env.MEDIA_X_ACCEL_REDIRECT) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...headers, 'X-Accel-Redirect': profileMediaXAccelUri(found.key) },
    });
  }
  // Range is defined for GET only (RFC 9110 §14.2) — a HEAD answers for the whole file.
  return new NextResponse(null, {
    status: 200,
    headers: { ...headers, 'content-length': String(found.size), 'accept-ranges': 'bytes' },
  });
}

export async function GET(req: Request) {
  const found = await resolve(req);
  if (typeof found === 'number') return refuse(found, true);
  const { key, size } = found;
  const headers = baseHeaders(key);

  // nginx does Range/206/416 itself on a handoff; Content-Type, Cache-Control and
  // Content-Disposition ride through it, and the `/_uploads/` location re-adds
  // nosniff (deploy conf, HEADERS note).
  if (env.MEDIA_X_ACCEL_REDIRECT) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...headers, 'X-Accel-Redirect': profileMediaXAccelUri(key) },
    });
  }

  const range = parseByteRange(req.headers.get('range'), size);
  if (range.type === 'unsatisfiable') {
    return new NextResponse(null, {
      status: 416,
      headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes', 'cache-control': NO_STORE },
    });
  }

  const start = range.type === 'range' ? range.start : 0;
  const end = range.type === 'range' ? range.end : size - 1;
  const body = openProfileMediaBody(key, start, end);
  if (!body) return refuse(404, true);

  if (range.type === 'range') {
    return new NextResponse(body, {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }
  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, 'content-length': String(size), 'accept-ranges': 'bytes' },
  });
}
