'use client';

// 长视频上传表单里的「封面与预览片段」— three reusable pieces wired to the video
// board, none of them forked:
//   · <VideoTrimDialog/>  (components/media — the 名片 editor's trimmer): pick the
//     ≤ 20 s hover-preview segment AND the cover frame in one gesture;
//     POST /api/videos/clip renders both server-side (lib/video/preview-clip.ts →
//     the shared lib/media/video-clip.ts renderers).
//   · <CoverCropDialog/>  (components/media — born as 投票's PosterCropEditor):
//     横版/竖版 + 裁切/完整显示/取景位置, the shared cover contract.
//   · <CoverImage/>       the same renderer every card uses, so the preview here
//     IS what the card will show.
// Uploading a poster image or a ready-made preview file by hand still works — a
// box without ffmpeg answers 501 and those two buttons are the way through.
//
// The trimmer plays the LOCAL file while it is still in this tab (a blob: url —
// no bytes leave the disk twice), otherwise the stored source through the
// login-walled file route (same-origin, so the filmstrip canvas is not tainted).

import { useRef, useState } from 'react';
import { Crop, Film, ImagePlus, Loader2, Scissors, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CoverCropDialog } from '@/components/media/CoverCropDialog';
import { CoverImage } from '@/components/media/CoverImage';
import { VideoTrimDialog } from '@/components/media/VideoTrimDialog';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import type { StoredClip } from '@/lib/media/clip-shared';
import { defaultCoverFor, videoCoverRatio, type CoverAspect } from '@/lib/media/cover-pos';
import { uploadVideoAsset } from './VideoUploadField';

/** Mirrors lib/video/preview-clip.ts (server-only module) — the server clamps again. */
const PREVIEW_MAX_SECONDS = 20;
const PREVIEW_MIN_SECONDS = 2;

export interface MediaRef {
  url: string;
  key?: string;
}

interface Props {
  source: (MediaRef & { durationSec?: number }) | null;
  /** blob: url of the just-picked source file, while it is still in this tab. */
  localSrc: string | null;
  poster: MediaRef | null;
  posterAspect: CoverAspect;
  posterPos: string;
  preview: MediaRef | null;
  clip: StoredClip | null;
  onPoster: (poster: MediaRef | null, framing?: { aspect: CoverAspect; pos: string }) => void;
  onFraming: (framing: { aspect: CoverAspect; pos: string }) => void;
  onPreview: (preview: MediaRef | null, clip: StoredClip | null) => void;
}

function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function VideoCoverClipField({ source, localSrc, poster, posterAspect, posterPos, preview, clip, onPoster, onFraming, onPreview }: Props) {
  const t = useTranslations('video');
  const posterInput = useRef<HTMLInputElement>(null);
  const previewInput = useRef<HTMLInputElement>(null);
  const hoverVideo = useRef<HTMLVideoElement>(null);
  const [trimOpen, setTrimOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'poster' | 'preview'>(null);
  const [progress, setProgress] = useState(0);

  const canTrim = Boolean(source?.key);
  const trimSrc = localSrc ?? (source ? withBasePath(source.url) : '');

  async function renderClip(result: { range: { start: number; end: number }; cover: number }) {
    if (!source?.key) return;
    setRendering(true);
    setTrimError(null);
    try {
      const res = await fetch('/api/videos/clip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoKey: source.key, start: result.range.start, end: result.range.end, cover: result.cover }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            preview?: { key: string; url: string };
            poster?: { key: string; url: string; width: number | null; height: number | null } | null;
            clip?: StoredClip;
          }
        | null;
      if (!res.ok || !data?.preview) {
        const code = data?.error ?? 'clip_failed';
        if (code === 'ffmpeg_unavailable') {
          // Nothing a retry can fix: close and point at the manual uploads.
          setTrimOpen(false);
          pushToast('error', t('manage.clip_err_unavailable'));
        } else {
          setTrimError(code === 'media_busy' || code === 'rate_limited' ? t('manage.clip_err_busy') : t('manage.clip_err_failed'));
        }
        return;
      }
      onPreview({ url: data.preview.url, key: data.preview.key }, data.clip ?? null);
      if (data.poster) {
        onPoster(
          { url: data.poster.url, key: data.poster.key },
          // A frame of the video has the video's own shape: a portrait recording starts as 竖版 + 完整显示.
          defaultCoverFor(data.poster.width ?? 0, data.poster.height ?? 0),
        );
      }
      setTrimOpen(false);
      pushToast('success', data.poster ? t('manage.clip_done') : t('manage.clip_done_no_poster'));
    } catch {
      setTrimError(t('manage.clip_err_failed'));
    } finally {
      setRendering(false);
    }
  }

  async function uploadPoster(file: File) {
    setBusy('poster');
    setProgress(0);
    try {
      const [dims, res] = await Promise.all([measureImage(file), uploadVideoAsset(file, 'poster', setProgress)]);
      onPoster({ url: res.url, key: res.key }, defaultCoverFor(dims?.width ?? 0, dims?.height ?? 0));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'upload_failed');
    } finally {
      setBusy(null);
    }
  }

  async function uploadPreview(file: File) {
    setBusy('preview');
    setProgress(0);
    try {
      const res = await uploadVideoAsset(file, 'preview', setProgress);
      onPreview({ url: res.url, key: res.key }, null); // a hand-made file has no source range
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : 'upload_failed');
    } finally {
      setBusy(null);
    }
  }

  const btn =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900';

  return (
    <div className="space-y-2.5">
      <label className="text-xs font-medium text-muted">{t('manage.cover_clip_label')}</label>

      {/* What a card will show: the poster through the shared renderer, the preview clip on hover. */}
      <div
        className="group relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        onPointerEnter={() => void hoverVideo.current?.play().catch(() => undefined)}
        onPointerLeave={() => {
          const el = hoverVideo.current;
          if (el) {
            el.pause();
            el.currentTime = 0;
          }
        }}
      >
        {poster ? (
          <CoverImage src={poster.url} aspect={posterAspect} pos={posterPos} loading="eager" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">{t('manage.cover_empty')}</div>
        )}
        {preview && (
          <video
            ref={hoverVideo}
            src={withBasePath(preview.url)}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            className="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          />
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 text-xs font-medium text-white">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {Math.round(progress)}%
            </span>
          </div>
        )}
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {preview ? t('manage.cover_badge_hover') : t('manage.cover_badge_card')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className={`${btn} col-span-2 border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white`} disabled={!canTrim} onClick={() => setTrimOpen(true)}>
          <Scissors className="h-3.5 w-3.5" aria-hidden />
          {clip ? t('manage.clip_again') : t('manage.clip_from_video')}
        </button>
        <button type="button" className={btn} disabled={busy !== null} onClick={() => posterInput.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
          {t('manage.upload_poster')}
        </button>
        <button type="button" className={btn} disabled={!poster} onClick={() => setCropOpen(true)}>
          <Crop className="h-3.5 w-3.5" aria-hidden />
          {t('manage.cover_adjust')}
        </button>
        <button type="button" className={btn} disabled={busy !== null} onClick={() => previewInput.current?.click()}>
          <Film className="h-3.5 w-3.5" aria-hidden />
          {t('manage.upload_preview_short')}
        </button>
        <button
          type="button"
          className={`${btn} text-danger hover:bg-danger/10`}
          disabled={!poster && !preview}
          onClick={() => {
            onPoster(null);
            onPreview(null, null);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t('manage.cover_clear')}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">{canTrim ? t('manage.clip_hint') : t('manage.clip_hint_no_source')}</p>

      <input
        ref={posterInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void uploadPoster(file);
        }}
      />
      <input
        ref={previewInput}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void uploadPreview(file);
        }}
      />

      <VideoTrimDialog
        open={trimOpen && Boolean(trimSrc)}
        src={trimSrc}
        title={t('manage.clip_title')}
        initialRange={clip ? { start: clip.start, end: clip.end } : null}
        initialCover={clip?.cover ?? null}
        maxLength={PREVIEW_MAX_SECONDS}
        minLength={PREVIEW_MIN_SECONDS}
        note={<p className="px-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t('manage.clip_note', { max: PREVIEW_MAX_SECONDS })}</p>}
        confirmLabel={t('manage.clip_confirm')}
        busy={rendering}
        busyLabel={t('manage.clip_rendering')}
        fallbackDuration={source?.durationSec ?? clip?.duration ?? null}
        maxDuration={source?.durationSec && source.durationSec > 0 ? source.durationSec : null}
        error={trimError}
        onCancel={() => {
          setTrimOpen(false);
          setTrimError(null);
        }}
        onConfirm={(r) => void renderClip(r)}
      />

      {poster && (
        <CoverCropDialog
          open={cropOpen}
          imageUrl={poster.url}
          aspect={posterAspect}
          pos={posterPos}
          ratioFor={videoCoverRatio}
          onAspectChange={(aspect) => onFraming({ aspect, pos: posterPos })}
          onPosChange={(pos) => onFraming({ aspect: posterAspect, pos })}
          onClose={() => setCropOpen(false)}
          title={t('manage.cover_adjust_title')}
          closeLabel={t('player.close')}
          doneLabel={t('manage.cover_done')}
          hint={t('manage.cover_adjust_hint')}
        >
          {/* The two places this cover is seen at size: a 16:9 card slot and the billboard's artwork frame. */}
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <figure className="min-w-0">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <CoverImage src={poster.url} aspect={posterAspect} pos={posterPos} loading="eager" />
              </div>
              <figcaption className="mt-1 text-[11px] text-muted">{t('manage.cover_preview_card')}</figcaption>
            </figure>
            <figure>
              <div
                className="relative h-28 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                style={{ aspectRatio: String(videoCoverRatio(posterAspect)) }}
              >
                <CoverImage src={poster.url} aspect={posterAspect} pos={posterPos} slot="adaptive" loading="eager" />
              </div>
              <figcaption className="mt-1 text-[11px] text-muted">{t('manage.cover_preview_hero')}</figcaption>
            </figure>
          </div>
        </CoverCropDialog>
      )}
    </div>
  );
}
