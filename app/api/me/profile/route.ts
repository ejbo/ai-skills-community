import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadOwnProfileSettings } from '@/lib/profile/card-view';
import { saveOwnProfile } from '@/lib/profile/profile-store';
import { readJsonCapped } from '@/lib/http/read-json-capped';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The largest honest body is ABOUT_MAX (4 000 code points ≈ 16 KB of UTF-8) plus
// a few small arrays; anything far past that is not a settings form.
const MAX_BODY_BYTES = 256 * 1024;

const NO_STORE = { 'cache-control': 'private, no-store' };

// GET /api/me/profile — the owner's own, untrimmed profile + 名片 settings.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return NextResponse.json(await loadOwnProfileSettings(session.user.id), { headers: NO_STORE });
}

// PUT /api/me/profile — any subset of
//   { headline, aboutMd, interests, links, layout, card, bannerUrl }
// Every field goes through its lib/profile/shared.ts sanitizer (content is
// capped/cleaned, a wrong SHAPE is a 400 — see lib/profile/profile-store.ts).
// `card` merges over the stored card; `layout: null` = 恢复默认. bannerUrl only
// accepts what POST /api/uploads/image returned (or the unchanged stored value).
// Card MEDIA is not set here — that is PUT /api/me/profile/media.
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // A Content-Length check alone is no cap (a chunked body has none) — the
  // reader stops at the cap instead of buffering whatever arrives.
  const read = await readJsonCapped(req, MAX_BODY_BYTES);
  if (!read.ok && read.error === 'payload_too_large') {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  const result = await saveOwnProfile(session.user.id, read.ok ? read.value : undefined);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.field ? { field: result.field } : {}) }, { status: 400 });
  }
  return NextResponse.json(await loadOwnProfileSettings(session.user.id), { headers: NO_STORE });
}
