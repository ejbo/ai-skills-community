import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonCapped } from '@/lib/http/read-json-capped';
import { clipOwnCardVideo } from '@/lib/profile/profile-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A key and three numbers; anything near this is not a clip request.
const MAX_BODY_BYTES = 8 * 1024;
const MINUTE_MS = 60 * 1000;
// Each request is a real encode holding the shared media-queue slot for seconds.
// A member re-trimming a few times a minute is fine; more is load, not taste.
const CLIPS_PER_MINUTE = 6;

const NO_STORE = { 'cache-control': 'private, no-store' };

// POST /api/me/profile/media/clip — cut the 名片 video clip from an uploaded
// original and attach it (step 2 of 2 for a video; step 1 is
// POST /api/profile/media/upload with x-upload-kind: video).
//
//   { videoKey: string, start: number, end: number, cover?: number }
//
// `videoKey` exactly as the upload returned it (it must carry the caller's owner
// tag — someone else's key is 400, like PUT). Times are SOURCE seconds. The
// server probes the file's real duration and clamps the range with the shared
// contract (lib/media/clip-shared.ts normalizeClipRange: ≤ PROFILE_CLIP_MAX_SECONDS
// long, ≥ 1 s, inside the source) and the cover into the range, then renders a
// muted ≤ 720 px, 1–30 fps faststart mp4 with no metadata plus a poster at the
// cover frame, attaches video + poster + clip in ONE transaction (the previous
// clip and poster are unlinked; the original stays, since it is still attached)
// and stores the range so the editor can reopen the trimmer on it. The range is
// clamped to the VIDEO stream's length (an audio track that outlasts the picture
// does not count), and a member may have only ONE clip request rendering at a time.
//
// → 200 { media: ProfileCardMedia, clip: { start, end, cover, duration } }
//   400 invalid_input       shape, not a video/ key, not the caller's, no decodable duration
//   401 unauthenticated     413 payload_too_large
//   404 media_missing       the original is not on disk (or vanished before the attach)
//   409 clip_in_progress    this member's previous clip request is still rendering; + retry-after
//   409 media_claimed       another profile holds a key (cannot happen for tagged keys; kept for parity with PUT)
//   429 rate_limited        + retry-after
//   500 clip_failed         the source would not decode / the output was not sane
//   501 ffmpeg_unavailable  this box cannot cut clips — attach a client poster via PUT instead
//   503 media_busy          no media-queue slot inside 30 s; + retry-after
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`profile:card-clip:${session.user.id}`, CLIPS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: 'rate_limited', resetAt: gate.resetAt },
      { status: 429, headers: { 'retry-after': String(retryAfter) } },
    );
  }

  const read = await readJsonCapped(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.error === 'payload_too_large'
      ? NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
      : NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const result = await clipOwnCardVideo(session.user.id, read.value);
  if (!result.ok) {
    const headers: Record<string, string> = { ...NO_STORE };
    if (result.retryAfter) headers['retry-after'] = String(result.retryAfter);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
  return NextResponse.json({ media: result.media, clip: result.clip }, { headers: NO_STORE });
}
