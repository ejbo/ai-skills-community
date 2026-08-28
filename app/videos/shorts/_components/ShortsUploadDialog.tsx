'use client';

// 上传短视频 dialog. Two phases: a full-bleed drag&drop pick zone, then a
// side-by-side edit layout (vertical preview left, caption + AI 润色 right).
// Upload rides the house raw-body XHR protocol (XHR for upload.onprogress; the
// fetch basePath shim does NOT cover XHR, so endpoints are wrapped in
// withBasePath explicitly). Publishing kicks off背景字幕生成 server-side.
//
// Design system notes: one radius scale (dialog 2xl, elements xl), single
// accent, label-above-input, visible focus rings, tactile :active presses,
// inline progress instead of spinners where the shape is known.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Captions, Clock, Film, Loader2, Proportions, Sparkles, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatDuration } from '@/lib/video/types';
import { MAX_SHORT_CAPTION_CHARS } from '@/lib/video/shorts-shared';
import { currentLoginHref } from '@/lib/auth/callback-path';
import type { ShortView } from './types';

const ACCEPTED_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

interface Meta {
  duration: number;
  width: number;
  height: number;
}

/** Raw-body upload protocol shared by every upload route in the app. */
function uploadRaw(
  file: Blob,
  filename: string,
  kind: 'source' | 'poster',
  onProgress?: (pct: number) => void,
): Promise<{ key: string; url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath('/api/shorts/upload'));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upload-kind', kind);
    xhr.setRequestHeader('x-filename', encodeURIComponent(filename));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('bad_response'));
        }
      } else {
        let msg = 'upload_failed';
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network_error'));
    xhr.send(file);
  });
}

/** Probe duration/dimensions and capture a poster frame from a picked file. */
async function probeAndCapture(url: string): Promise<{ meta: Meta; poster: Blob | null }> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe_timeout')), 15000);
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error('probe_failed'));
    };
  });

  // Streamed/recorded WebM often reports duration = Infinity from metadata
  // alone. Standard workaround: seek far past the end — the durationchange
  // that follows carries the real value.
  if (!Number.isFinite(video.duration)) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 8000);
      video.ondurationchange = () => {
        if (Number.isFinite(video.duration)) {
          clearTimeout(timer);
          resolve();
        }
      };
      video.currentTime = Number.MAX_SAFE_INTEGER;
    });
    try {
      video.currentTime = 0;
    } catch {
      /* fine — the capture step seeks anyway */
    }
    if (!Number.isFinite(video.duration)) throw new Error('probe_failed');
  }

  const meta: Meta = {
    duration: video.duration || 0,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
  };

  // Poster capture is best-effort — publishing without one is fine (the player
  // then shows the first decoded frame).
  let poster: Blob | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seek_timeout')), 8000);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('seek_failed'));
      };
      video.currentTime = Math.min(0.5, (meta.duration || 1) / 2);
    });
    const canvas = document.createElement('canvas');
    const scale = meta.width > 720 ? 720 / meta.width : 1;
    canvas.width = Math.max(1, Math.round(meta.width * scale));
    canvas.height = Math.max(1, Math.round(meta.height * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
      );
    }
  } catch {
    poster = null;
  }
  video.removeAttribute('src');
  video.load();
  return { meta, poster };
}

interface Props {
  onClose: () => void;
  onPublished: (short: ShortView) => void;
}

export function ShortsUploadDialog({ onClose, onPublished }: Props) {
  const t = useTranslations('shorts');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [poster, setPoster] = useState<Blob | null>(null);
  const [probing, setProbing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [caption, setCaption] = useState('');
  const [origin, setOrigin] = useState<'original' | 'repost'>('original');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceAuthor, setSourceAuthor] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'publishing'>('idle');
  const [pct, setPct] = useState(0);
  const busy = phase !== 'idle';
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    objectUrlRef.current = objectUrl;
  }, [objectUrl]);
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function uploadErrorKey(e: unknown): string {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'file_too_large') return 'err_too_large';
    if (msg === 'unsupported_type') return 'err_unsupported';
    if (msg === 'quota_exceeded') return 'err_quota';
    if (msg === 'insufficient_storage') return 'err_no_space';
    if (msg === 'rate_limited') return 'err_rate_limited';
    if (msg === 'network_error') return 'err_network';
    return 'err_upload_failed';
  }

  async function pick(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    if (!ACCEPTED_TYPES.has(f.type)) {
      pushToast('error', t('err_unsupported'));
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(f);
    setFile(f);
    setObjectUrl(url);
    setMeta(null);
    setPoster(null);
    setProbing(true);
    try {
      const { meta: m, poster: p } = await probeAndCapture(url);
      setMeta(m);
      setPoster(p);
    } catch {
      pushToast('error', t('err_probe_failed'));
      setFile(null);
      setObjectUrl(null);
      URL.revokeObjectURL(url);
    } finally {
      setProbing(false);
    }
  }

  function resetPick() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    setFile(null);
    setObjectUrl(null);
    setMeta(null);
    setPoster(null);
  }

  async function polish() {
    const draft = caption.trim();
    if (!draft || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch('/api/shorts/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('ai_failed'));
        return;
      }
      if (typeof data.caption === 'string' && data.caption.trim()) {
        setCaption(data.caption.trim().slice(0, MAX_SHORT_CAPTION_CHARS));
        pushToast('success', t('ai_done'));
      }
    } catch {
      pushToast('error', t('ai_failed'));
    } finally {
      setAiBusy(false);
    }
  }

  async function publish() {
    if (!file || !meta || !caption.trim() || busy) return;
    if (origin === 'repost' && (!/^https?:\/\//.test(sourceUrl.trim()) || !sourceAuthor.trim())) {
      pushToast('error', t('err_source_required'));
      return;
    }
    setPhase('uploading');
    setPct(0);
    try {
      const src = await uploadRaw(file, file.name, 'source', setPct);
      let posterKey: string | undefined;
      if (poster) {
        try {
          const p = await uploadRaw(poster, 'poster.jpg', 'poster');
          posterKey = p.key;
        } catch {
          /* poster is optional — publish without it */
        }
      }
      setPhase('publishing');
      const res = await fetch('/api/shorts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          videoKey: src.key,
          posterKey,
          durationSec: Math.max(1, Math.round(meta.duration)),
          width: meta.width || undefined,
          height: meta.height || undefined,
          originType: origin,
          sourceUrl: origin === 'repost' ? sourceUrl.trim() : undefined,
          sourceAuthor: origin === 'repost' ? sourceAuthor.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(currentLoginHref());
        return;
      }
      if (!res.ok) {
        pushToast('error', data.reason ?? t('err_publish_failed'));
        return;
      }
      onPublished(data.short as ShortView);
    } catch (e) {
      pushToast('error', t(uploadErrorKey(e)));
    } finally {
      setPhase('idle');
    }
  }

  const ready =
    Boolean(file && meta && caption.trim()) &&
    (origin === 'original' || Boolean(sourceUrl.trim() && sourceAuthor.trim())) &&
    !probing &&
    !busy;

  const inputCls =
    'w-full rounded-xl border border-zinc-300 bg-transparent px-3.5 py-2.5 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/15 dark:border-zinc-700 dark:focus:border-zinc-400';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={t('upload_title')}
        className="max-h-[90dvh] w-[min(94vw,640px)] overflow-y-auto rounded-2xl bg-white text-zinc-900 shadow-2xl dark:bg-zinc-950 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">{t('upload_title')}</h2>
            <p className="mt-0.5 text-xs text-muted">{t('upload_sub')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 active:scale-95 dark:hover:bg-zinc-800"
            aria-label={t('close')}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {!file ? (
            /* Phase 1 — pick / drop */
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void pick(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition ${
                dragOver
                  ? 'border-zinc-900 bg-zinc-100/70 dark:border-zinc-200 dark:bg-zinc-900'
                  : 'border-zinc-300 hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900/60'
              }`}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                <Upload className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  {dragOver ? t('drop_to_select') : t('pick_video')}
                </p>
                <p className="mt-1.5 text-xs text-muted">{t('pick_hint')}</p>
              </div>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          ) : (
            /* Phase 2 — preview + caption */
            <div className="grid gap-5 sm:grid-cols-[190px,minmax(0,1fr)]">
              <div className="mx-auto w-full max-w-[220px]">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-black ring-1 ring-zinc-200 dark:ring-zinc-800">
                  {objectUrl && (
                    // eslint-disable-next-line jsx-a11y/media-has-caption -- user-picked local preview
                    <video
                      src={objectUrl}
                      controls
                      muted
                      playsInline
                      className="h-full w-full object-contain"
                    />
                  )}
                  {probing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </div>
                {!busy && (
                  <button
                    type="button"
                    onClick={resetPick}
                    className="mt-2 w-full rounded-xl border border-zinc-200 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {t('repick')}
                  </button>
                )}
              </div>

              <div className="min-w-0">
                {/* Meta chips */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="inline-flex max-w-[180px] items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    <Film className="h-3 w-3 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  {meta && (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        <Clock className="h-3 w-3" />
                        {formatDuration(Math.round(meta.duration))}
                      </span>
                      {meta.width > 0 && meta.height > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 tabular-nums text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                          <Proportions className="h-3 w-3" />
                          {meta.width}×{meta.height}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {meta && meta.width > meta.height && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {t('landscape_hint')}
                  </p>
                )}

                {/* 内容来源: 自创 / 搬运 */}
                <div className="mt-4">
                  <p className="mb-1.5 text-sm font-medium">{t('origin_label')}</p>
                  <div className="flex gap-2">
                    {(['original', 'repost'] as const).map((o) => (
                      <button
                        key={o}
                        type="button"
                        disabled={busy}
                        onClick={() => setOrigin(o)}
                        aria-pressed={origin === o}
                        className={`rounded-xl border px-4 py-1.5 text-sm font-medium transition active:scale-[0.98] ${
                          origin === o
                            ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                            : 'border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500'
                        }`}
                      >
                        {t(o === 'original' ? 'origin_original' : 'origin_repost')}
                      </button>
                    ))}
                  </div>
                  {origin === 'repost' && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label htmlFor="shorts-source-url" className="mb-1 block text-xs font-medium">
                          {t('source_url_label')}
                        </label>
                        <input
                          id="shorts-source-url"
                          type="url"
                          value={sourceUrl}
                          onChange={(e) => setSourceUrl(e.target.value)}
                          disabled={busy}
                          placeholder={t('source_url_placeholder')}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="shorts-source-author"
                          className="mb-1 block text-xs font-medium"
                        >
                          {t('source_author_label')}
                        </label>
                        <input
                          id="shorts-source-author"
                          type="text"
                          value={sourceAuthor}
                          onChange={(e) => setSourceAuthor(e.target.value.slice(0, 100))}
                          disabled={busy}
                          placeholder={t('source_author_placeholder')}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Caption */}
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="shorts-caption" className="text-sm font-medium">
                      {t('caption_label')}
                    </label>
                    <button
                      type="button"
                      onClick={() => void polish()}
                      disabled={aiBusy || !caption.trim() || busy}
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-95 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      {aiBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {t('ai_polish')}
                    </button>
                  </div>
                  <textarea
                    id="shorts-caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, MAX_SHORT_CAPTION_CHARS))}
                    rows={5}
                    disabled={busy}
                    placeholder={t('caption_placeholder')}
                    className={`${inputCls} resize-none`}
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Captions className="h-3 w-3" />
                      {t('subtitle_hint')}
                    </span>
                    <span className="tabular-nums">
                      {caption.length}/{MAX_SHORT_CAPTION_CHARS}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          {phase === 'uploading' && (
            <div className="mb-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-white"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                {t('uploading', { pct: Math.round(pct) })}
              </p>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
              className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!ready}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 active:scale-[0.98] disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {phase === 'publishing' ? t('publishing') : t('publish')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
