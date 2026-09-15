import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { clearOwnCardMedia, setOwnCardMedia, sweepOwnUnattachedCardMedia } from '@/lib/profile/profile-store';
import { readJsonCapped } from '@/lib/http/read-json-capped';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Four short keys; anything near this is not an attach request.
const MAX_BODY_BYTES = 8 * 1024;

// PUT /api/me/profile/media — attach uploaded 名片 media (step 2 of 2).
//   { kind: 'image', mediaKey }
//   { kind: 'video', mediaKey, posterKey?: string | null, loopKey?: string | null }
// Keys only, exactly as POST /api/profile/media/upload returned them. The server
// re-checks each key's kind/shape, that the file exists and is non-empty, and
// that no OTHER profile already holds it (transaction + @unique columns → 409
// media_claimed), and that every key was uploaded BY THE CALLER (owner tag in the
// key → 400 invalid_input otherwise). A video needs a loop or a poster (400
// media_missing) — a card never plays the original. URLs are rebuilt from the
// keys, never accepted. The previous files are unlinked after the commit.
// → { media: ProfileCardMedia | null }
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const read = await readJsonCapped(req, MAX_BODY_BYTES);
  if (!read.ok && read.error === 'payload_too_large') {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  const result = await setOwnCardMedia(session.user.id, read.ok ? read.value : undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ media: result.media }, { headers: { 'cache-control': 'private, no-store' } });
}

// DELETE /api/me/profile/media — remove the card photo/video (the card falls
// back to the avatar / monogram). → { media: null }
// Unconditional for the owner: it clears whatever the row holds — valid, legacy
// or pointing at a missing file — so no stored state can make media unremovable.
// An upload that was never attached is not "the card's media" and is not touched
// here; the abandoned-upload sweep (24 h) reclaims those, and is nudged here too.
export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  await clearOwnCardMedia(session.user.id);
  void sweepOwnUnattachedCardMedia(session.user.id);
  return NextResponse.json({ media: null }, { headers: { 'cache-control': 'private, no-store' } });
}
