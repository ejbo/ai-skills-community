import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import {
  isAllowedZoneImageType,
  maxBytesForZoneKind,
  newZoneMediaKey,
  saveZoneMediaStream,
  zoneMediaExtFor,
  zoneMediaPublicUrl,
  type ZoneMediaKind,
} from '@/lib/zones/storage';
import { MINUTE_MS } from '../../_zone-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_PER_MINUTE = 30;

// POST /api/zones/[slug]/upload — raw-body upload of the zone's brand images
// (zone `manage`). Post attachments live on /attachments/upload (A2).
// Headers:
//   content-type:   image MIME (validated against ZONE_IMAGE_TYPES)
//   x-upload-kind:  'cover' | 'icon'
//   x-filename:     encodeURIComponent(file.name) — extension hint only
// The file is stored immediately; the zone row points at it only after the
// client echoes `{ coverKey | iconKey }` through PATCH /api/zones/[slug].
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:upload-brand:${session.user.id}`, UPLOADS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canManage) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const kindRaw = req.headers.get('x-upload-kind') ?? 'cover';
  if (kindRaw !== 'cover' && kindRaw !== 'icon') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const kind: ZoneMediaKind = kindRaw;

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  // A malformed %-escape in x-filename must not 500 the upload.
  let filename = '';
  try {
    filename = decodeURIComponent(req.headers.get('x-filename') ?? '');
  } catch {
    filename = '';
  }

  if (!isAllowedZoneImageType(contentType)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });

  const max = maxBytesForZoneKind(kind);
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  if (!req.body) return NextResponse.json({ error: 'empty_body' }, { status: 400 });

  const key = newZoneMediaKey(kind, zoneMediaExtFor(kind, contentType, filename));
  try {
    const size = await saveZoneMediaStream(key, req.body, max);
    return NextResponse.json({ key, url: zoneMediaPublicUrl(key), size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload_failed';
    if (msg === 'file_too_large') return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (msg === 'empty_body') return NextResponse.json({ error: 'empty_body' }, { status: 400 });
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
