'use client';

// 名片媒体: upload a photo or a short video for the card.
//
// Pipeline (SPEC §3.3 contracts):
//   pick / drop → checkCardFile (type — with the route's extension fallback —
//                 + per-kind cap, the route's own rules)
//   photo: stripImageMetadata (decode → canvas → WebP/JPEG: EXIF/GPS never leaves
//          the browser, orientation baked in; undecodable ⇒ refused, never raw)
//          GIF keeps its bytes (animation, no EXIF block)
//   image: uploadRaw(kind image) ─────────────────────────────┐
//   video: probeAndCapture (local poster frame, best-effort)   │
//          uploadRaw(kind video) → server loop + poster        │
//          no server poster? upload the captured frame (poster)│
//                                                              ▼
//   PUT /api/me/profile/media {kind, mediaKey, posterKey?, loopKey?} → { media }
//
// Media is applied IMMEDIATELY (not held for the page's 保存): the PUT is what
// claims the keys and unlinks the previous files, so there is nothing to stage.
// While it runs the host previews an object URL of the picked file, so the
// member sees their card change the moment they choose — then swaps to the
// served URLs. Every object URL is revoked; an unmount aborts the XHR.
//
// Framing (`mediaPos`) belongs to a picture, so it is reset when a file is
// PICKED — before the local preview appears — not when the upload lands: a
// member who reframes the preview while a 40 MB video uploads keeps that
// framing. If the upload fails or is cancelled, the framing from before the
// pick comes back, since the old photo is still the one on the card.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Film, ImageIcon, ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { UploadError, uploadRaw } from '@/components/zones/attachments/upload-core';
import { probeAndCapture } from '@/app/votes/_components/vote-upload';
import { withBasePath } from '@/lib/base-path';
import { PROFILE_IMAGE_MAX_BYTES, PROFILE_LOOP_SECONDS, PROFILE_VIDEO_MAX_BYTES } from '@/lib/profile/shared';
import type { ProfileCardMedia } from '@/lib/profile/types';
import { CARD_MEDIA_ACCEPT, bytesToMb, cardMediaErrorKey, checkCardFile, shouldStripImage } from '../_components/editor-shared';
import { stripImageMetadata } from '../_components/strip-image';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, HINT_CLS } from '../_components/ui';
import { useCoarsePointer } from '../_components/useCoarsePointer';

const UPLOAD_ENDPOINT = '/api/profile/media/upload';

/** POST /api/profile/media/upload response (SPEC §3.3). A video's `url` is its loop or poster (never the original), or null. */
interface MediaUploadResult {
  kind: string;
  key: string;
  url: string | null;
  size: number;
  posterKey: string | null;
  posterUrl: string | null;
  loopKey: string | null;
  loopUrl: string | null;
  durationSec: number | null;
}

type Phase =
  | { step: 'idle' }
  | { step: 'preparing'; kind: 'image' | 'video'; name: string }
  | { step: 'uploading'; kind: 'image' | 'video'; name: string; pct: number }
  | { step: 'finishing'; kind: 'image' | 'video'; name: string };

async function readErrorCode(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (res.status === 429) return 'rate_limited';
  return typeof data.error === 'string' ? data.error : res.status === 401 ? 'unauthenticated' : 'upload_failed';
}

export function CardMediaField({
  media,
  mediaPos,
  onMediaChange,
  onMediaPosChange,
  onLocalPreview,
  onBusyChange,
}: {
  /** The saved media (what the server currently serves). */
  media: ProfileCardMedia | null;
  /** Draft object-position, so the thumbnail frames like the card. */
  mediaPos: string;
  /** A new saved media value (after PUT/DELETE succeeded). */
  onMediaChange: (media: ProfileCardMedia | null) => void;
  /** Draft framing: '' when a new file is picked, the pre-pick value back when its upload fails. */
  onMediaPosChange: (pos: string) => void;
  /** Object-URL preview while an upload runs; null when it ends (either way). */
  onLocalPreview: (media: ProfileCardMedia | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('settings');
  const router = useRouter();
  // A finger only reframes through the preview's 调整取景 toggle (see PreviewStage),
  // so the reframe hint names that step on touch screens.
  const coarse = useCoarsePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrls = useRef<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [thumb, setThumb] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const busy = phase.step !== 'idle' || removing;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const revokeAll = useCallback(() => {
    for (const u of objectUrls.current) URL.revokeObjectURL(u);
    objectUrls.current = [];
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      revokeAll();
    },
    [revokeAll],
  );

  // 确认移除 falls back to the plain button if the member walks away.
  useEffect(() => {
    if (!confirmRemove) return;
    const timer = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  function objectUrl(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    objectUrls.current.push(u);
    return u;
  }

  async function saveMedia(body: Record<string, unknown>): Promise<ProfileCardMedia | null> {
    const res = await fetch('/api/me/profile/media', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new UploadError(await readErrorCode(res));
    const data = (await res.json().catch(() => null)) as { media?: ProfileCardMedia | null } | null;
    return data?.media ?? null;
  }

  async function handleFile(file: File) {
    if (busy) return;
    const check = checkCardFile(file);
    if (!check.ok) {
      pushToast(
        'error',
        check.error === 'file_too_large'
          ? t('ce_err_too_large_mb', { mb: bytesToMb(check.maxBytes) })
          : t(cardMediaErrorKey(check.error)),
      );
      return;
    }
    const kind = check.kind;
    const controller = new AbortController();
    abortRef.current = controller;
    setConfirmRemove(false);
    // Snapshot of the draft framing at pick time (this render's value).
    const framingBefore = mediaPos;
    let picked = false;

    try {
      let upload = file;
      if (kind === 'image' && shouldStripImage(check.ext)) {
        setPhase({ step: 'preparing', kind, name: file.name });
        try {
          upload = await stripImageMetadata(file);
        } catch {
          throw new UploadError('unsupported_type');
        }
        if (controller.signal.aborted) throw new UploadError('aborted');
        if (upload.size > check.maxBytes) throw new UploadError('file_too_large');
      }

      picked = true;
      onMediaPosChange('');
      const localUrl = objectUrl(upload);
      let posterBlob: Blob | null = null;

      if (kind === 'video') {
        setPhase({ step: 'preparing', kind, name: file.name });
        onLocalPreview({ kind: 'video', url: localUrl, posterUrl: null, playUrl: localUrl });
        try {
          posterBlob = (await probeAndCapture(localUrl)).poster;
        } catch {
          // A codec the browser cannot decode (e.g. HEVC .mov in Chrome) still
          // uploads — the server may cut a poster; the card falls back if not.
          posterBlob = null;
        }
        if (controller.signal.aborted) throw new UploadError('aborted');
        const posterUrl = posterBlob ? objectUrl(posterBlob) : null;
        setThumb(posterUrl);
        onLocalPreview({ kind: 'video', url: localUrl, posterUrl, playUrl: localUrl });
      } else {
        setThumb(localUrl);
        onLocalPreview({ kind: 'image', url: localUrl, posterUrl: null, playUrl: null });
      }

      setPhase({ step: 'uploading', kind, name: file.name, pct: 0 });
      const uploaded = (await uploadRaw(
        upload,
        UPLOAD_ENDPOINT,
        { 'x-upload-kind': kind },
        (pct) => setPhase({ step: 'uploading', kind, name: file.name, pct }),
        controller.signal,
      )) as unknown as MediaUploadResult;

      setPhase({ step: 'finishing', kind, name: file.name });
      let saved: ProfileCardMedia | null;
      if (kind === 'image') {
        saved = await saveMedia({ kind: 'image', mediaKey: uploaded.key });
      } else {
        // The server's own poster wins; the client-captured frame is only the
        // fallback for a box without ffmpeg (or a codec it could not cut).
        let posterKey = uploaded.posterKey ?? null;
        if (!posterKey && posterBlob) {
          try {
            const posterFile = new File([posterBlob], 'poster.jpg', { type: 'image/jpeg' });
            const p = await uploadRaw(posterFile, UPLOAD_ENDPOINT, { 'x-upload-kind': 'poster' }, undefined, controller.signal);
            posterKey = p.key;
          } catch (e) {
            if (e instanceof UploadError && e.code === 'aborted') throw e;
            posterKey = null; // a missing poster is not worth failing the video for
          }
        }
        saved = await saveMedia({ kind: 'video', mediaKey: uploaded.key, posterKey, loopKey: uploaded.loopKey ?? null });
      }

      onMediaChange(saved);
      pushToast('success', kind === 'image' ? t('ce_media_saved_image') : t('ce_media_saved_video'));
      router.refresh();
    } catch (e) {
      // The card still shows the old media: give it back the framing it had.
      if (picked) onMediaPosChange(framingBefore);
      const code = e instanceof UploadError ? e.code : 'upload_failed';
      if (code === 'aborted') pushToast('info', t('ce_upload_cancelled'));
      else pushToast('error', t(cardMediaErrorKey(code)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      onLocalPreview(null);
      setThumb(null);
      revokeAll();
      setPhase({ step: 'idle' });
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setRemoving(true);
    try {
      const res = await fetch('/api/me/profile/media', { method: 'DELETE' });
      if (!res.ok) throw new UploadError(await readErrorCode(res));
      onMediaChange(null);
      pushToast('success', t('ce_media_removed'));
      router.refresh();
    } catch {
      pushToast('error', t('save_failed'));
    } finally {
      setRemoving(false);
    }
  }

  const shownKind = phase.step !== 'idle' ? phase.kind : media?.kind ?? null;
  const thumbSrc = thumb ?? (media ? withBasePath(media.kind === 'image' ? media.url : media.posterUrl) || null : null);
  const pct = phase.step === 'uploading' ? Math.round(phase.pct) : phase.step === 'finishing' ? 100 : 0;

  return (
    <div
      onDragOver={(e) => {
        if (busy || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
      className={`relative rounded-xl border p-3 transition sm:p-4 ${
        dragOver
          ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Thumbnail — framed with the draft object-position, like the card */}
        <div className="relative h-28 w-[5.25rem] shrink-0 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-inset ring-black/5 dark:bg-zinc-900 dark:ring-white/10 sm:h-32 sm:w-24">
          {thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL or stored root-relative media
            <img src={thumbSrc} alt="" className="h-full w-full object-cover" style={{ objectPosition: mediaPos || undefined }} />
          ) : shownKind === 'video' ? (
            <div className="flex h-full w-full items-center justify-center text-zinc-400">
              <Film className="h-6 w-6" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-600">
              <ImagePlus className="h-6 w-6" />
            </div>
          )}
          {shownKind && (
            <span className="absolute bottom-1 left-1 inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-md bg-zinc-950/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {shownKind === 'video' ? <Film className="h-3 w-3 shrink-0" /> : <ImageIcon className="h-3 w-3 shrink-0" />}
              <span className="truncate">{shownKind === 'video' ? t('ce_media_kind_video') : t('ce_media_kind_image')}</span>
            </span>
          )}
          {phase.step !== 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/35">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {phase.step !== 'idle'
              ? phase.step === 'preparing'
                ? t('ce_media_preparing')
                : phase.step === 'uploading'
                  ? t('ce_media_uploading', { pct })
                  : t('ce_media_finishing')
              : media
                ? media.kind === 'video'
                  ? t('ce_media_current_video')
                  : t('ce_media_current_image')
                : t('ce_media_none')}
          </p>
          {/* A file name may truncate; a hint sentence wraps (en/fr run twice as long as zh). */}
          <p className={`mt-0.5 text-xs leading-snug text-muted ${phase.step !== 'idle' ? 'truncate' : ''}`}>
            {phase.step !== 'idle'
              ? phase.name
              : media?.kind === 'video'
                ? media.playUrl
                  ? t('ce_media_video_loop', { seconds: PROFILE_LOOP_SECONDS })
                  : t('ce_media_video_poster_only')
                : media
                  ? coarse
                    ? t('ce_media_image_hint_touch')
                    : t('ce_media_image_hint')
                  : t('ce_media_none_hint')}
          </p>

          {phase.step !== 'idle' ? (
            <div className="mt-3 flex items-center gap-3">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={`h-full rounded-full bg-zinc-900 transition-[width] duration-200 motion-reduce:transition-none dark:bg-zinc-100 ${
                    phase.step === 'preparing' ? 'w-1/4 motion-safe:animate-pulse' : ''
                  }`}
                  style={phase.step === 'preparing' ? undefined : { width: `${Math.max(4, pct)}%` }}
                />
              </div>
              {phase.step !== 'finishing' && (
                <button type="button" onClick={() => abortRef.current?.abort()} className={`${BTN_GHOST} h-7 px-2 text-xs`}>
                  <X className="h-3.5 w-3.5" />
                  {t('ce_upload_cancel')}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className={media ? BTN_SECONDARY : BTN_PRIMARY}>
                <Upload className="h-4 w-4" />
                {media ? t('ce_media_replace') : t('ce_media_upload')}
              </button>
              {media && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className={
                    confirmRemove
                      ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/50 bg-danger/10 px-3.5 text-sm font-medium text-danger transition hover:bg-danger/15'
                      : `${BTN_GHOST} h-9`
                  }
                >
                  {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {confirmRemove ? t('ce_media_remove_confirm') : t('ce_media_remove')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className={`${HINT_CLS} mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/70`}>
        {t('ce_media_caps', {
          imageMb: bytesToMb(PROFILE_IMAGE_MAX_BYTES),
          videoMb: bytesToMb(PROFILE_VIDEO_MAX_BYTES),
          seconds: PROFILE_LOOP_SECONDS,
        })}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={CARD_MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
