'use client';

// 名片媒体: upload a photo, or a video the member trims to a ≤ 30 s clip.
//
// Photo pipeline (SPEC §3.3 contracts):
//   pick / drop → checkCardFile (type — with the route's extension fallback —
//                 + per-kind cap, the route's own rules)
//   stripImageMetadata (decode → canvas → WebP/JPEG: EXIF/GPS never leaves the
//   browser, orientation baked in; undecodable ⇒ refused, never raw). GIF keeps
//   its bytes (animation, no EXIF block).
//   uploadRaw(kind image) → PUT /api/me/profile/media {kind:'image', mediaKey}
//
// Video pipeline (视频截取, SPEC-TRIM):
//   pick / drop → checkCardFile → <VideoTrimDialog/> opens AT ONCE on an object
//   URL of the local file while uploadRaw(kind video) sends the original in the
//   background (progress + retry in the dialog's note; 确认 waits for it).
//   确认 → POST /api/me/profile/media/clip {videoKey, start, end, cover}
//          → the server cuts the muted clip + a poster at the cover frame and
//            attaches both in one step → { media, clip }
//   A failed clip request (clipFailureAction, editor-shared):
//   · 501 ffmpeg_unavailable — and 500 clip_failed on a NEW upload — → poster-only
//          fallback: capture the cover frame in the browser, upload it as
//          `poster`, PUT {kind:'video', mediaKey, posterKey, loopKey:null}; the
//          card shows only that cover and the member is told so. A re-trim of a
//          video that ALREADY plays a clip never takes this path — trading a
//          working clip for a still is not what 剪辑片段 means.
//   · transient (media_busy, clip_in_progress, rate_limited, network) or a
//          re-trim's clip_failed → the dialog stays open on the same selection
//          with the error and 重试 (clip wording, not upload wording).
//   · invalid_input / media_missing / unauthenticated → retrying cannot help:
//          the dialog closes with the message.
//   取消 → aborts the upload; nothing is attached (the owner sweep reclaims any
//          file that did land).
//   剪辑片段 (saved video) → the same dialog on the OWNER-ONLY source URL, opened
//          at the stored range; 确认 re-cuts from the same original. When this
//          browser cannot show the original (HEVC without a decoder) the dialog
//          offers start / end fields against the stored clip's source duration,
//          so the member can still re-cut; a HEAD on the source tells a missing
//          original (404) apart from a codec problem, which the media element
//          reports identically.
//
// Media is applied IMMEDIATELY (not held for the page's 保存): the attach is what
// claims the keys and unlinks the previous files, so there is nothing to stage.
// NO router.refresh() after an attach / remove: CardEditor holds the media in
// state and nothing server-rendered on /settings/card shows it, while a refresh
// wiped the member's UNSAVED 名片 edits and dropped focus to <body> — in Next
// 14.2.18 the first refresh after a page load re-creates the root cache node
// without its `loading` (app/loading.tsx), so the LoadingBoundary flips from
// <Suspense> to a fragment and React remounts the whole settings segment. What
// the refresh used to buy — the Router Cache not re-mounting this page with the
// pre-change payload — is kept by ./applied-media (onMediaChange reports both
// the media and its source for that).
// A photo previews as an object URL while it uploads; every object URL is
// revoked; an unmount aborts the XHR.
//
// Framing (`mediaPos`) belongs to a picture, so it is reset for a new picture:
// a photo resets it when PICKED (before the local preview appears) and restores
// it if the upload fails; a new video resets it when its clip is attached (the
// card behind the modal keeps the old media until then). A re-trim keeps it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Film, ImageIcon, ImagePlus, Loader2, RotateCcw, Scissors, Trash2, Upload, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { VideoTrimDialog } from '@/components/media/VideoTrimDialog';
import { captureVideoFrame } from '@/components/media/filmstrip';
import { UploadError, uploadRaw } from '@/components/zones/attachments/upload-core';
import { withBasePath } from '@/lib/base-path';
import { CLIP_MIN_LENGTH_DEFAULT, formatClipTime, parseStoredClip, type ClipRange, type StoredClip } from '@/lib/media/clip-shared';
import { PROFILE_CLIP_MAX_SECONDS, PROFILE_IMAGE_MAX_BYTES, PROFILE_VIDEO_MAX_BYTES, profileMediaSourceUrl } from '@/lib/profile/shared';
import type { ProfileCardMedia } from '@/lib/profile/types';
import {
  CARD_MEDIA_ACCEPT,
  bytesToMb,
  cardMediaErrorKey,
  checkCardFile,
  clipFailureAction,
  shouldStripImage,
} from '../_components/editor-shared';
import { stripImageMetadata } from '../_components/strip-image';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, HINT_CLS } from '../_components/ui';
import { useCoarsePointer } from '../_components/useCoarsePointer';

const UPLOAD_ENDPOINT = '/api/profile/media/upload';
const CLIP_ENDPOINT = '/api/me/profile/media/clip';

/** POST /api/profile/media/upload response. A video is stored + probed only: no URL, no derivatives. */
interface MediaUploadResult {
  kind: string;
  key: string;
  url: string | null;
  size: number;
  durationSec: number | null;
}

/** The saved video's original, as far as this editor knows it (settings read-back, or an upload it just attached). */
export interface CardVideoSource {
  key: string;
  /** Owner-only source URL (root-relative); null when the server did not offer one. */
  url: string | null;
  clip: StoredClip | null;
}

type Phase =
  | { step: 'idle' }
  | { step: 'preparing'; name: string }
  | { step: 'uploading'; name: string; pct: number }
  | { step: 'finishing'; name: string };

type UploadState =
  | { state: 'uploading'; pct: number }
  | { state: 'done'; durationSec: number | null }
  | { state: 'failed'; code: string };

/**
 * Why the dialog shows no preview. 'decode' — this browser cannot play the source
 * (the server still can); 'missing' — a re-trim's original answered 404; 'network'
 * — it could not be reached; 'checking' — a re-trim failure whose cause the HEAD
 * probe has not answered yet.
 */
type PreviewFailure = 'decode' | 'missing' | 'network' | 'checking';

/** One open trimmer. `id` tells a late XHR / request callback whether its session is still the open one. */
interface TrimSession {
  id: number;
  mode: 'new' | 'retrim';
  /** blob: URL of the picked file, or the withBasePath'ed owner-only source URL. */
  src: string;
  file: File | null;
  /** The uploaded original's key (null until the upload lands). */
  key: string | null;
  /** new: the server's probe of the upload; retrim: the stored clip's source duration (null when unknown). */
  upload: UploadState;
  initialRange: ClipRange | null;
  initialCover: number | null;
  /** Duration the browser reported (0 until known). */
  duration: number;
  previewFailed: PreviewFailure | null;
  /** Duration the media element had read before it failed (null when it never got that far). */
  failedDuration: number | null;
  busy: boolean;
  /** `settings` message key of the last failed clip request the member can retry (null = none). */
  clipError: string | null;
}

/** The source's duration for the dialog's typed-range fallback, when this session may offer one. */
function sessionFallbackDuration(s: TrimSession): number | null {
  if (s.upload.state !== 'done' || !s.upload.durationSec) return null;
  // A re-trim offers numbers only once the original is known to be there (HEAD 200).
  if (s.mode === 'retrim' && s.previewFailed !== 'decode') return null;
  return s.upload.durationSec;
}

async function readErrorCode(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (res.status === 429) return 'rate_limited';
  return typeof data.error === 'string' ? data.error : res.status === 401 ? 'unauthenticated' : 'upload_failed';
}

export function CardMediaField({
  media,
  initialSource,
  mediaPos,
  onMediaChange,
  onMediaPosChange,
  onLocalPreview,
  onBusyChange,
}: {
  /** The saved media (what the server currently serves). */
  media: ProfileCardMedia | null;
  /** The saved video's original + clip (OwnProfileSettings.mediaKeys/sourceUrl/clip); null for none / an image. */
  initialSource: CardVideoSource | null;
  /** Draft object-position, so the thumbnail frames like the card. */
  mediaPos: string;
  /** A new saved media value (after an attach / DELETE succeeded), with the video original it plays from (null for none / a photo). */
  onMediaChange: (media: ProfileCardMedia | null, source: CardVideoSource | null) => void;
  /** Draft framing: '' for a new picture, the pre-pick value back when a photo upload fails. */
  onMediaPosChange: (pos: string) => void;
  /** Object-URL preview while a photo uploads; null when it ends (either way). */
  onLocalPreview: (media: ProfileCardMedia | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('settings');
  const locale = useLocale();
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
  const [source, setSource] = useState<CardVideoSource | null>(initialSource);
  const [trim, setTrim] = useState<TrimSession | null>(null);
  const trimRef = useRef<TrimSession | null>(null);
  const sessionSeq = useRef(0);
  const lastPct = useRef(-1);
  const busy = phase.step !== 'idle' || removing || trim !== null;
  // The trimmer is modal, so its session does not disable the buttons behind it: a
  // disabled button loses focus, and the dialog could not hand focus back to the
  // 更换 / 剪辑片段 button that opened it. The handlers still refuse while `busy`.
  const buttonsDisabled = phase.step !== 'idle' || removing;

  useEffect(() => {
    trimRef.current = trim;
  }, [trim]);

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

  // The trimmer's local object URL lives exactly as long as its session — revoked
  // after the dialog (and its <video>) has unmounted, never under a playing element.
  const trimSrc = trim?.src ?? null;
  useEffect(() => {
    if (!trimSrc || !trimSrc.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(trimSrc);
  }, [trimSrc]);

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

  /** Functional update of the open session, ignored once that session is closed or replaced. */
  const patchTrim = useCallback((id: number, patch: Partial<TrimSession> | ((s: TrimSession) => Partial<TrimSession>)) => {
    setTrim((s) => (s && s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s));
  }, []);

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

  function handleFile(file: File) {
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
    setConfirmRemove(false);
    if (check.kind === 'video') openNewVideo(file);
    else void uploadPhoto(file, check.ext, check.maxBytes);
  }

  // ─── photo ───────────────────────────────────────────────────────────────

  async function uploadPhoto(file: File, ext: string, maxBytes: number) {
    const controller = new AbortController();
    abortRef.current = controller;
    // Snapshot of the draft framing at pick time (this render's value).
    const framingBefore = mediaPos;
    let picked = false;

    try {
      let upload = file;
      if (shouldStripImage(ext)) {
        setPhase({ step: 'preparing', name: file.name });
        try {
          upload = await stripImageMetadata(file);
        } catch {
          throw new UploadError('unsupported_type');
        }
        if (controller.signal.aborted) throw new UploadError('aborted');
        if (upload.size > maxBytes) throw new UploadError('file_too_large');
      }

      picked = true;
      onMediaPosChange('');
      const localUrl = objectUrl(upload);
      setThumb(localUrl);
      onLocalPreview({ kind: 'image', url: localUrl, posterUrl: null, playUrl: null });

      setPhase({ step: 'uploading', name: file.name, pct: 0 });
      const uploaded = await uploadRaw(
        upload,
        UPLOAD_ENDPOINT,
        { 'x-upload-kind': 'image' },
        (pct) => setPhase({ step: 'uploading', name: file.name, pct }),
        controller.signal,
      );

      setPhase({ step: 'finishing', name: file.name });
      const saved = await saveMedia({ kind: 'image', mediaKey: uploaded.key });
      setSource(null);
      onMediaChange(saved, null);
      pushToast('success', t('ce_media_saved_image'));
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

  // ─── video: trim session ─────────────────────────────────────────────────

  function openNewVideo(file: File) {
    const id = ++sessionSeq.current;
    const session: TrimSession = {
      id,
      mode: 'new',
      src: URL.createObjectURL(file),
      file,
      key: null,
      upload: { state: 'uploading', pct: 0 },
      initialRange: null,
      initialCover: null,
      duration: 0,
      previewFailed: null,
      failedDuration: null,
      busy: false,
      clipError: null,
    };
    trimRef.current = session;
    setTrim(session);
    void uploadOriginal(id, file);
  }

  async function uploadOriginal(id: number, file: File) {
    const controller = new AbortController();
    abortRef.current = controller;
    lastPct.current = -1;
    patchTrim(id, { upload: { state: 'uploading', pct: 0 } });
    try {
      const uploaded = (await uploadRaw(
        file,
        UPLOAD_ENDPOINT,
        { 'x-upload-kind': 'video' },
        (pct) => {
          // One render per whole percent — XHR progress fires far more often.
          const whole = Math.floor(pct);
          if (whole === lastPct.current) return;
          lastPct.current = whole;
          patchTrim(id, { upload: { state: 'uploading', pct: whole } });
        },
        controller.signal,
      )) as unknown as MediaUploadResult;
      patchTrim(id, { key: uploaded.key, upload: { state: 'done', durationSec: uploaded.durationSec ?? null } });
    } catch (e) {
      const code = e instanceof UploadError ? e.code : 'upload_failed';
      // 取消 already closed the session (and said so).
      if (code !== 'aborted') patchTrim(id, { upload: { state: 'failed', code } });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function openRetrim() {
    if (busy || !source?.url) return;
    const id = ++sessionSeq.current;
    const clip = source.clip;
    const session: TrimSession = {
      id,
      mode: 'retrim',
      src: withBasePath(source.url),
      file: null,
      key: source.key,
      upload: { state: 'done', durationSec: clip?.duration ?? null },
      initialRange: clip ? { start: clip.start, end: clip.end } : null,
      initialCover: clip?.cover ?? null,
      duration: 0,
      previewFailed: null,
      failedDuration: null,
      busy: false,
      clipError: null,
    };
    trimRef.current = session;
    setTrim(session);
  }

  function closeTrim() {
    trimRef.current = null;
    setTrim(null);
  }

  function cancelTrim() {
    const s = trimRef.current;
    if (!s || s.busy) return;
    const wasUploading = s.mode === 'new' && s.upload.state === 'uploading';
    abortRef.current?.abort();
    closeTrim();
    if (wasUploading) pushToast('info', t('ce_upload_cancelled'));
  }

  /**
   * The preview could not be shown. A blob: source is a local file, so that is the
   * codec. A re-trim's remote original fails the SAME way when it is simply gone, so
   * unless the element already read its metadata (then the file is there) a HEAD
   * decides between "cut it by numbers" and "the original is missing".
   */
  function onPreviewError(id: number, reason: 'decode' | 'network', info: { duration: number | null }) {
    const s = trimRef.current;
    if (!s || s.id !== id) return;
    if (s.mode === 'new' || info.duration != null) {
      patchTrim(id, { previewFailed: 'decode', failedDuration: info.duration });
      return;
    }
    patchTrim(id, { previewFailed: 'checking', failedDuration: null });
    const url = source?.url;
    if (!url) {
      patchTrim(id, { previewFailed: reason === 'network' ? 'network' : 'missing' });
      return;
    }
    fetch(url, { method: 'HEAD', cache: 'no-store' }).then(
      (res) => patchTrim(id, { previewFailed: res.ok ? 'decode' : res.status === 404 ? 'missing' : 'network' }),
      () => patchTrim(id, { previewFailed: 'network' }),
    );
  }

  async function confirmTrim(result: { range: ClipRange; cover: number; duration: number }) {
    const s = trimRef.current;
    if (!s || !s.key || s.busy) return;
    const { id, key } = s;
    patchTrim(id, { busy: true, clipError: null });
    let code: string;
    let status = 0;
    try {
      const res = await fetch(CLIP_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoKey: key, start: result.range.start, end: result.range.end, cover: result.cover }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { media?: ProfileCardMedia | null; clip?: unknown } | null;
        if (data?.media) {
          if (s.mode === 'new') onMediaPosChange('');
          const next: CardVideoSource = { key, url: profileMediaSourceUrl(key), clip: parseStoredClip(data.clip) };
          setSource(next);
          onMediaChange(data.media, next);
          pushToast('success', t(s.mode === 'new' ? 'ce_media_saved_video' : 'ce_trim_saved'));
          closeTrim();
          return;
        }
        code = 'clip_failed';
      } else {
        status = res.status;
        code = await readErrorCode(res);
      }
    } catch {
      code = 'network_error';
    }

    const action = clipFailureAction(code, status, s.mode);
    if (action === 'poster_fallback') {
      await posterOnlyFallback(s, result.cover, code === 'clip_failed' ? 'failed' : 'unavailable');
    } else if (action === 'close') {
      pushToast('error', t(cardMediaErrorKey(code, 'clip')));
      closeTrim();
    } else {
      patchTrim(id, { busy: false, clipError: cardMediaErrorKey(code, 'clip') });
    }
  }

  /**
   * The server cannot cut this clip — no ffmpeg on the box ('unavailable') or this
   * new upload would not render ('failed'): attach the original with a
   * browser-captured poster at the cover frame, and say the card shows only that.
   */
  async function posterOnlyFallback(s: TrimSession, cover: number, why: 'unavailable' | 'failed') {
    const key = s.key as string;
    if (s.mode === 'retrim' && media?.kind === 'video' && media.playUrl) {
      pushToast('error', t('ce_err_retrim_unavailable'));
      closeTrim();
      return;
    }
    try {
      const poster = s.previewFailed ? null : await captureVideoFrame(s.src, cover, { maxEdge: 1280 });
      if (!poster) {
        pushToast('error', t('ce_err_video_unusable'));
        closeTrim();
        return;
      }
      const posterFile = new File([poster], 'poster.jpg', { type: 'image/jpeg' });
      const p = await uploadRaw(posterFile, UPLOAD_ENDPOINT, { 'x-upload-kind': 'poster' });
      const saved = await saveMedia({ kind: 'video', mediaKey: key, posterKey: p.key, loopKey: null });
      if (s.mode === 'new') onMediaPosChange('');
      const next: CardVideoSource = { key, url: profileMediaSourceUrl(key), clip: null };
      setSource(next);
      onMediaChange(saved, next);
      pushToast('info', t(why === 'failed' ? 'ce_trim_poster_only_failed' : 'ce_trim_poster_only'));
      closeTrim();
    } catch (e) {
      // These are an upload and a save (upload wording); only a transient one keeps the dialog.
      const code = e instanceof UploadError ? e.code : 'upload_failed';
      if (clipFailureAction(code, 0, 'retrim') === 'close') {
        pushToast('error', t(cardMediaErrorKey(code)));
        closeTrim();
      } else {
        patchTrim(s.id, { busy: false, clipError: cardMediaErrorKey(code) });
      }
    }
  }

  // ─── remove ──────────────────────────────────────────────────────────────

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
      setSource(null);
      onMediaChange(null, null);
      pushToast('success', t('ce_media_removed'));
    } catch {
      pushToast('error', t('save_failed'));
    } finally {
      setRemoving(false);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────────

  const shownKind = phase.step !== 'idle' ? 'image' : media?.kind ?? null;
  const thumbSrc = thumb ?? (media ? withBasePath(media.kind === 'image' ? media.url : media.posterUrl) || null : null);
  const pct = phase.step === 'uploading' ? Math.round(phase.pct) : phase.step === 'finishing' ? 100 : 0;
  const canRetrim = media?.kind === 'video' && !!source?.url;
  const secondsFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  let videoHint = '';
  if (media?.kind === 'video') {
    const clip = source?.clip;
    videoHint = !media.playUrl
      ? t('ce_media_video_poster_only')
      : clip
        ? t('ce_media_video_clip', {
            start: formatClipTime(clip.start),
            end: formatClipTime(clip.end),
            seconds: secondsFmt.format(Number((clip.end - clip.start).toFixed(1))),
          })
        : t('ce_media_video_loop');
  }

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
        if (f) handleFile(f);
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
          {(phase.step !== 'idle' || trim) && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/35">
              <Loader2 className="h-5 w-5 animate-spin text-white motion-reduce:animate-none" />
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
              : trim
                ? t('ce_trim_in_progress')
                : media
                  ? media.kind === 'video'
                    ? t('ce_media_current_video')
                    : t('ce_media_current_image')
                  : t('ce_media_none')}
          </p>
          {/* A file name may truncate; a hint sentence wraps (en/fr run twice as long as zh). */}
          <p className={`mt-0.5 text-xs leading-snug text-muted ${phase.step !== 'idle' || trim?.file ? 'truncate' : ''}`}>
            {phase.step !== 'idle'
              ? phase.name
              : trim?.file
                ? trim.file.name
                : media?.kind === 'video'
                  ? videoHint
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
              <button type="button" onClick={() => inputRef.current?.click()} disabled={buttonsDisabled} className={media ? BTN_SECONDARY : BTN_PRIMARY}>
                <Upload className="h-4 w-4" />
                {media ? t('ce_media_replace') : t('ce_media_upload')}
              </button>
              {canRetrim && (
                <button type="button" onClick={openRetrim} disabled={buttonsDisabled} className={BTN_SECONDARY}>
                  <Scissors className="h-4 w-4" />
                  {t('ce_media_trim')}
                </button>
              )}
              {media && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={buttonsDisabled}
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
          seconds: PROFILE_CLIP_MAX_SECONDS,
        })}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={CARD_MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <VideoTrimDialog
        open={trim !== null}
        src={trim?.src ?? ''}
        title={trim?.mode === 'retrim' ? t('ce_trim_title_edit') : t('ce_trim_title')}
        initialRange={trim?.initialRange ?? null}
        initialCover={trim?.initialCover ?? null}
        maxLength={PROFILE_CLIP_MAX_SECONDS}
        minLength={CLIP_MIN_LENGTH_DEFAULT}
        confirmLabel={t('ce_trim_confirm')}
        confirmDisabled={!trim?.key || trim.upload.state !== 'done'}
        busy={trim?.busy ?? false}
        busyLabel={t('ce_trim_busy')}
        fallbackDuration={trim ? sessionFallbackDuration(trim) : null}
        maxDuration={trim && trim.upload.state === 'done' ? trim.upload.durationSec ?? null : null}
        error={trim?.clipError ? t(trim.clipError) : null}
        retryLabel={t('ce_trim_retry')}
        onDuration={(sec) => trim && patchTrim(trim.id, { duration: sec })}
        onError={(reason, info) => trim && onPreviewError(trim.id, reason, info)}
        onCancel={cancelTrim}
        onConfirm={(result) => void confirmTrim(result)}
        note={trim ? <TrimNote session={trim} onRetry={() => trim.file && void uploadOriginal(trim.id, trim.file)} /> : null}
      />
    </div>
  );
}

/** The dialog's note: upload progress / failure for a new video, then what the card will do with the clip. */
function TrimNote({ session, onRetry }: { session: TrimSession; onRetry: () => void }) {
  const t = useTranslations('settings');
  const { mode, upload, duration, previewFailed, failedDuration } = session;
  const max = PROFILE_CLIP_MAX_SECONDS;

  // What the card does with the selection (only once the browser knows the length).
  // A failed preview is explained here only when the dialog cannot offer the typed
  // start / end fields in its place (those carry their own explanation).
  let behaviour: string | null = null;
  if (previewFailed) {
    const canType = sessionFallbackDuration(session) != null || failedDuration != null;
    if (previewFailed === 'missing') behaviour = t('ce_err_media_missing');
    else if (previewFailed === 'network') behaviour = t('ce_trim_source_error');
    else if (previewFailed === 'decode' && !canType) {
      if (mode === 'retrim') behaviour = t('ce_trim_decode_unknown');
      else if (upload.state === 'done') behaviour = t('ce_err_video_unusable');
    }
  } else if (duration > 0) {
    behaviour =
      duration > max
        ? t('ce_trim_note_long', { seconds: max })
        : mode === 'new'
          ? t('ce_trim_note_short', { seconds: max })
          : t('ce_trim_note_short_edit', { seconds: max });
  }

  // One box for every upload state, at one height: the dialog must not jump
  // while a member is dragging a handle just because the upload finished.
  const box = 'flex min-h-[3.25rem] flex-col justify-center rounded-lg border px-3 py-2';
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      {mode === 'new' && upload.state !== 'failed' && (
        <div className={`${box} border-zinc-200 dark:border-zinc-800`}>
          <div className="flex items-center justify-between gap-3 text-zinc-700 dark:text-zinc-300">
            <span className="flex min-w-0 items-center gap-1.5">
              {upload.state === 'uploading' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0" aria-live="polite">
                {upload.state === 'uploading' ? t('ce_trim_uploading') : t('ce_trim_uploaded')}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
              {upload.state === 'uploading' ? upload.pct : 100}%
            </span>
          </div>
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-label={t('ce_trim_uploading')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.state === 'uploading' ? upload.pct : 100}
          >
            <div
              className="h-full rounded-full bg-zinc-900 transition-[width] duration-200 motion-reduce:transition-none dark:bg-zinc-100"
              style={{ width: `${upload.state === 'uploading' ? Math.max(3, upload.pct) : 100}%` }}
            />
          </div>
        </div>
      )}
      {mode === 'new' && upload.state === 'failed' && (
        <div role="alert" className={`${box} border-danger/40 bg-danger/5 text-danger`}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">{t(cardMediaErrorKey(upload.code))}</span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('ce_trim_retry')}
            </button>
          </div>
        </div>
      )}
      {behaviour && <p className="text-zinc-600 dark:text-zinc-400">{behaviour}</p>}
      <p className="text-zinc-500 dark:text-zinc-500">{t('ce_trim_private')}</p>
    </div>
  );
}
