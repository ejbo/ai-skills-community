import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonCapped } from '@/lib/http/read-json-capped';
import { renderVideoPreviewClip } from '@/lib/video/preview-clip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A key, three numbers and a flag; anything near this is not a clip request.
const MAX_BODY_BYTES = 8 * 1024;
const MINUTE_MS = 60 * 1000;
// Each request is a real encode holding the shared media-queue slot for seconds.
const CLIPS_PER_MINUTE = 8;
const NO_STORE = { 'cache-control': 'private, no-store' };

// POST /api/videos/clip (`videos`) — cut the hover-preview clip (and a poster at
// the chosen frame) from an uploaded source. Step 2 of the long-video upload:
// step 1 is POST /api/videos/upload (x-upload-kind: source), whose `key` is the
// `videoKey` here. Nothing is attached to a Video row by this route — the form
// echoes the returned keys on save, exactly like the files it uploads by hand.
//
//   { videoKey: string, start: number, end: number, cover?: number, poster?: boolean }
//
// Times are SOURCE seconds. The server probes the real picture length and clamps
// the range with the shared contract (lib/media/clip-shared.ts: ≤ 20 s, ≥ 2 s,
// inside the source) and the cover into the range.
//
// → 200 { preview: {key,url}, poster: {key,url,width,height} | null, clip: {start,end,cover,duration} }
//   400 invalid_input       shape, not a source/ key, not a decodable video
//   401 unauthenticated     403 forbidden     413 payload_too_large
//   404 media_missing       the source is not on disk
//   429 rate_limited        + retry-after
//   500 clip_failed         the source would not decode / the output was not sane
//   501 ffmpeg_unavailable  this box cannot cut clips — upload a preview file instead
//   503 media_busy          no media-queue slot inside 30 s; + retry-after
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!can(session.user, 'videos')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const gate = rateLimit(`videos:clip:${session.user.id}`, CLIPS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: 'rate_limited', resetAt: gate.resetAt },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(retryAfter) } },
    );
  }

  const read = await readJsonCapped(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.error === 'payload_too_large'
      ? NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
      : NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const body = read.value && typeof read.value === 'object' ? (read.value as Record<string, unknown>) : {};

  const result = await renderVideoPreviewClip({
    videoKey: body.videoKey,
    start: body.start,
    end: body.end,
    cover: body.cover,
    poster: body.poster,
  });
  if (!result.ok) {
    const headers: Record<string, string> = { ...NO_STORE };
    if (result.retryAfter) headers['retry-after'] = String(result.retryAfter);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
  return NextResponse.json({ preview: result.preview, poster: result.poster, clip: result.clip }, { headers: NO_STORE });
}
