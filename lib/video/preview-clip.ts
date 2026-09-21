// 长视频「截取预览片段 + 选帧封面」— the video board's use of the shared clip
// renderers (lib/media/video-clip.ts), the same ones the 名片 editor cuts its loop
// with. The manager picks a segment and a cover frame in <VideoTrimDialog/>;
// POST /api/videos/clip hands the range here and gets back a hover-preview clip
// plus a full-quality poster, both written into the videos storage.
//
// Before this the hover preview was "a second file an admin uploads by hand",
// which in practice meant most videos had none (and the card/billboard fell back
// to a still). Nothing about the DELIVERY contract changes: cards and the
// billboard still play ONLY `previewUrl`, never the source.
//
// Absolute paths never leave this module; callers pass storage keys. Never
// throws — every outcome is a value.

import { nanoid } from 'nanoid';
import { normalizeClipRange, normalizeCover, type StoredClip } from '@/lib/media/clip-shared';
import { sniffVideoContainerFile } from '@/lib/media/container-sniff';
import { hasFfmpeg, hasFfprobe, probeMediaFile, videoTimelineSec } from '@/lib/media/ffmpeg';
import { clipOutputFps, renderClip, renderFrame } from '@/lib/media/video-clip';
import { tryRunMediaJob } from '@/lib/uploads/job-queue';
import { deleteVideoFile, statVideoFileAsync, videoFileAbsPath, videoPublicUrl } from './storage';

/** Longest hover preview. A card plays it muted on hover and the billboard loops it — a teaser, not an excerpt. */
export const VIDEO_PREVIEW_MAX_SECONDS = 20;
export const VIDEO_PREVIEW_MIN_SECONDS = 2;

/** Long edge of the clip: the billboard artwork is ≤ ~870 CSS px wide, a card ~320. */
const PREVIEW_MAX_EDGE = 960;
const PREVIEW_MAX_FPS = 30;
const PREVIEW_CRF = 27;
/** VBV peak: 20 s × 1.6 Mbps ≈ 4 MB worst case — it is fetched on hover. */
const PREVIEW_MAXRATE_KBPS = 1600;
const PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
/** The poster is the video's face everywhere (cards, billboard, player) — full HD, high quality. */
const POSTER_MAX_EDGE = 1920;
const POSTER_QUALITY = 3;
const POSTER_MAX_BYTES = 12 * 1024 * 1024;

// Budgets — the request must answer inside nginx's proxy_read_timeout 300s:
// 10 s probe + 30 s queue wait + 180 s encode (+ ≤ 5 s verify) + 20 s poster.
const PROBE_TIMEOUT_MS = 10_000;
const JOB_MAX_WAIT_MS = 30_000;
const CLIP_TIMEOUT_MS = 180_000;
const POSTER_TIMEOUT_MS = 12_000;
const POSTER_FALLBACK_TIMEOUT_MS = 8_000;

/** `source/<nanoid>.<ext>` exactly as POST /api/videos/upload mints it — the only keys a clip may be cut from. */
const SOURCE_KEY_RE = /^source\/[A-Za-z0-9_-]{8,64}\.(?:mp4|webm|mov)$/;

export function isVideoSourceKey(key: unknown): key is string {
  return typeof key === 'string' && SOURCE_KEY_RE.test(key);
}

export type PreviewClipResult =
  | {
      ok: true;
      preview: { key: string; url: string };
      poster: { key: string; url: string; width: number | null; height: number | null } | null;
      clip: StoredClip;
    }
  | { ok: false; status: 400 | 404 | 500 | 501 | 503; error: string; retryAfter?: number };

export interface PreviewClipRequest {
  videoKey: unknown;
  start: unknown;
  end: unknown;
  cover?: unknown;
  /** false ⇒ cut only the clip and leave the poster alone. Default true. */
  poster?: unknown;
}

export async function clipToolsAvailable(): Promise<boolean> {
  const [ffmpeg, ffprobe] = await Promise.all([hasFfmpeg(), hasFfprobe()]);
  return ffmpeg && ffprobe;
}

/**
 * Cut the hover-preview clip (muted, ≤ 960 px, ≤ 30 fps, faststart, no source
 * metadata) and — unless `poster: false` — a poster at the cover frame, in ONE
 * media-queue slot. The range is re-normalised HERE against the probed picture
 * length with the same function the trimmer used, so what the handles showed is
 * what gets cut and a crafted body cannot ask for more than the cap.
 */
export async function renderVideoPreviewClip(req: PreviewClipRequest): Promise<PreviewClipResult> {
  try {
    if (!isVideoSourceKey(req.videoKey)) return { ok: false, status: 400, error: 'invalid_input' };
    const src = videoFileAbsPath(req.videoKey);
    if (!src || !(await statVideoFileAsync(req.videoKey))) return { ok: false, status: 404, error: 'media_missing' };
    if (!(await clipToolsAvailable())) return { ok: false, status: 501, error: 'ffmpeg_unavailable' };
    // ffmpeg picks a demuxer from CONTENT: a text `ffconcat` list saved as .mov
    // would otherwise render some OTHER file (see lib/media/ffmpeg.ts).
    if (!(await sniffVideoContainerFile(src))) return { ok: false, status: 400, error: 'invalid_input' };

    const probe = await probeMediaFile(src, PROBE_TIMEOUT_MS);
    if (!probe || !probe.hasVideo) return { ok: false, status: 400, error: 'invalid_input' };
    const duration = Math.round(videoTimelineSec(probe) * 10) / 10;
    const range = normalizeClipRange({ start: req.start, end: req.end }, duration, {
      maxLength: VIDEO_PREVIEW_MAX_SECONDS,
      minLength: VIDEO_PREVIEW_MIN_SECONDS,
    });
    if (!range) return { ok: false, status: 400, error: 'invalid_input' };
    const cover = normalizeCover(req.cover, range);
    const wantPoster = req.poster !== false;

    const previewKey = `preview/${nanoid()}.mp4`;
    const posterKey = `poster/${nanoid()}.jpg`;
    const previewPath = videoFileAbsPath(previewKey);
    const posterPath = videoFileAbsPath(posterKey);
    if (!previewPath || !posterPath) return { ok: false, status: 500, error: 'clip_failed' };

    const job = await tryRunMediaJob(async (): Promise<'ok' | 'ok_no_poster' | 'failed'> => {
      const clipped = await renderClip({
        input: src,
        output: previewPath,
        startSec: range.start,
        endSec: range.end,
        maxEdge: PREVIEW_MAX_EDGE,
        fps: clipOutputFps(probe.fps, PREVIEW_MAX_FPS),
        crf: PREVIEW_CRF,
        maxrateKbps: PREVIEW_MAXRATE_KBPS,
        mute: true,
        timeoutMs: CLIP_TIMEOUT_MS,
        maxBytes: PREVIEW_MAX_BYTES,
      });
      if (!clipped) return 'failed';
      if (!wantPoster) return 'ok_no_poster';
      const frame = { output: posterPath, maxEdge: POSTER_MAX_EDGE, quality: POSTER_QUALITY, maxBytes: POSTER_MAX_BYTES };
      // The source at full quality first; a container whose duration outruns its
      // last frame can miss there, and the clip we just verified cannot.
      const postered =
        (await renderFrame({ ...frame, input: src, atSec: cover, timeoutMs: POSTER_TIMEOUT_MS })) ||
        (await renderFrame({
          ...frame,
          input: previewPath,
          atSec: Math.max(0, cover - range.start),
          timeoutMs: POSTER_FALLBACK_TIMEOUT_MS,
        }));
      // Unlike a 名片, a video without a fresh poster is still fine — the form keeps whatever poster it had.
      return postered ? 'ok' : 'ok_no_poster';
    }, JOB_MAX_WAIT_MS);

    if (!job.ran) return { ok: false, status: 503, error: 'media_busy', retryAfter: 15 };
    if (job.value === 'failed') {
      await deleteVideoFile(previewKey);
      return { ok: false, status: 500, error: 'clip_failed' };
    }
    return {
      ok: true,
      preview: { key: previewKey, url: videoPublicUrl(previewKey) },
      poster:
        job.value === 'ok'
          ? { key: posterKey, url: videoPublicUrl(posterKey), width: probe.width, height: probe.height }
          : null,
      clip: { ...range, cover, duration },
    };
  } catch {
    return { ok: false, status: 500, error: 'clip_failed' };
  }
}

/** ffprobe a stored source for the upload response (duration, display size) — null on any failure. */
export async function probeVideoSource(key: string): Promise<{ durationSec: number; width: number | null; height: number | null } | null> {
  if (!isVideoSourceKey(key)) return null;
  const full = videoFileAbsPath(key);
  if (!full || !(await hasFfprobe())) return null;
  const probe = await probeMediaFile(full, PROBE_TIMEOUT_MS);
  if (!probe || !probe.hasVideo) return null;
  return { durationSec: videoTimelineSec(probe), width: probe.width, height: probe.height };
}
