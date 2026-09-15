import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import {
  openProfileMediaBody,
  parseByteRange,
  profileMediaContentType,
  profileMediaServeTarget,
  profileMediaXAccelUri,
  statProfileMedia,
  type ProfileMediaServeTarget,
} from '@/lib/profile/card-media-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET|HEAD /api/profile/media/[...key] — PUBLIC byte server for 名片 photos,
// posters and hover loops, with HTTP Range (Safari/iOS will not play a video
// without it).
//
// Public on purpose: /users/[handle] is anonymous-readable and its hero is the
// card, so its media must load without cookies. What keeps that from being a
// no-login file host is the ATTACHMENT check: a key is served only while an
// active member's UserProfile references it in the matching @unique column
// (image → cardMediaKey of an image card; poster / loop → cardPosterKey /
// cardLoopKey of a video card). An upload nobody attached, a file its owner
// removed, a deactivated member's card — all 404. A `video/` ORIGINAL is never
// served at all (profileMediaServeTarget): the card plays the generated 8 s
// muted loop, and the original has full length, audio and container metadata.
//
// Because removal is meaningful, the cache is short and not `immutable`: a key
// never changes content (a replacement is a new key), so 10 minutes is only the
// window in which a browser may keep showing a removed photo.
//
// HEAD is explicit and never touches the file: Next's auto-HEAD runs GET and
// drops the body without cancelling it, which pinned one file descriptor per
// request. GET bodies are lazy for the same reason (openProfileMediaBody).

const CACHE_CONTROL = 'public, max-age=600';

const ATTACHMENT_SELECT = { cardMediaKind: true, user: { select: { isActive: true } } } as const;

function findAttachment(key: string, target: ProfileMediaServeTarget) {
  switch (target.column) {
    case 'cardMediaKey':
      return prisma.userProfile.findUnique({ where: { cardMediaKey: key }, select: ATTACHMENT_SELECT });
    case 'cardPosterKey':
      return prisma.userProfile.findUnique({ where: { cardPosterKey: key }, select: ATTACHMENT_SELECT });
    case 'cardLoopKey':
      return prisma.userProfile.findUnique({ where: { cardLoopKey: key }, select: ATTACHMENT_SELECT });
  }
}

/** Shape → never-served kinds → attached to an active member's card → on disk. */
async function resolveServable(params: { key: string[] }): Promise<{ key: string; size: number } | null> {
  let key: string;
  try {
    key = params.key.map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  const target = profileMediaServeTarget(key);
  if (!target) return null;
  const row = await findAttachment(key, target);
  if (!row || !row.user.isActive || row.cardMediaKind !== target.kind) return null;
  const stat = await statProfileMedia(key);
  return stat ? { key, size: stat.size } : null;
}

function baseHeaders(key: string): Record<string, string> {
  return {
    'content-type': profileMediaContentType(key),
    'cache-control': CACHE_CONTROL,
    'x-content-type-options': 'nosniff',
    // Never a filename: nothing user-supplied reaches a header.
    'content-disposition': 'inline',
  };
}

const notFound = () => new NextResponse('Not found', { status: 404 });

export async function HEAD(_req: Request, { params }: { params: { key: string[] } }) {
  const found = await resolveServable(params);
  if (!found) return new NextResponse(null, { status: 404 });
  const headers = baseHeaders(found.key);
  if (env.MEDIA_X_ACCEL_REDIRECT && found.size > 0) {
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

export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const found = await resolveServable(params);
  if (!found) return notFound();
  const { key, size } = found;
  const headers = baseHeaders(key);

  // Guards a zero-length read range on an empty file.
  if (size === 0) {
    return new NextResponse(null, { status: 200, headers: { ...headers, 'content-length': '0' } });
  }

  // nginx does Range/206/416 itself on a handoff, so send no length/range of our
  // own (ours would describe the whole file and contradict a 206). The existing
  // `/_uploads/` location covers this folder and re-adds nosniff.
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
      headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' },
    });
  }

  const start = range.type === 'range' ? range.start : 0;
  const end = range.type === 'range' ? range.end : size - 1;
  const body = openProfileMediaBody(key, start, end);
  if (!body) return notFound();

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
