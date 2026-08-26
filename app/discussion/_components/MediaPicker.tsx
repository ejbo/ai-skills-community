'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Paperclip,
  Play,
  Video,
  X,
} from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import { formatBytes } from './types';

// Shared attachment picker for the 动态 composer AND the forum topic form:
// image gallery (≤9), ONE video (uploaded — inline playable — or an external
// link rendered as a card; the intranet can't embed iframes), and PDF/PPT/Word
// files (≤4, downloadable). Uploads go through the existing raw-body routes.

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';
const FILE_ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx';
const MAX_IMAGES = 9;
const MAX_FILES = 4;

export interface UploadedItem {
  key: string;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaDraft {
  images: UploadedItem[];
  video: UploadedItem | null;
  videoLink: string;
  files: UploadedItem[];
}

export const EMPTY_MEDIA: MediaDraft = { images: [], video: null, videoLink: '', files: [] };

export function mediaCount(d: MediaDraft): number {
  return d.images.length + d.files.length + (d.video ? 1 : 0) + (d.videoLink ? 1 : 0);
}

/** The API payload shape (lib/discussion-media.ts mediaArraySchema). */
export function mediaPayload(d: MediaDraft) {
  return [
    ...d.images.map((m) => ({
      kind: 'image' as const,
      key: m.key,
      name: m.name,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
    })),
    ...(d.video
      ? [
          {
            kind: 'video' as const,
            key: d.video.key,
            name: d.video.name,
            mimeType: d.video.mimeType,
            sizeBytes: d.video.sizeBytes,
          },
        ]
      : []),
    ...(d.videoLink ? [{ kind: 'video_link' as const, url: d.videoLink }] : []),
    ...d.files.map((m) => ({
      kind: 'file' as const,
      key: m.key,
      name: m.name,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
    })),
  ];
}

/** Raw-body upload protocol shared by every upload route in the app. */
function uploadRaw(
  file: File,
  endpoint: string,
  extraHeaders: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<{ key: string; url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(endpoint));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    for (const [k, v] of Object.entries(extraHeaders)) xhr.setRequestHeader(k, v);
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

/** Maps an upload error to its 'discussion' namespace message key. */
function uploadErrorKey(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'file_too_large') return 'err_file_too_large';
  if (msg === 'unsupported_type') return 'err_unsupported_type';
  if (msg === 'rate_limited') return 'err_rate_limited';
  if (msg === 'quota_exceeded') return 'err_quota_exceeded';
  return 'err_upload_failed';
}

export function MediaPicker({
  value,
  onChange,
  onUploadingChange,
}: {
  value: MediaDraft;
  onChange: (next: MediaDraft) => void;
  /** Reports the number of in-flight uploads so the parent can gate submit. */
  onUploadingChange?: (count: number) => void;
}) {
  const t = useTranslations('discussion');
  const [uploading, setUploading] = useState(0);
  const [videoPct, setVideoPct] = useState<number | null>(null);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Async upload loops read the latest draft from a ref — two parallel uploads
  // updating from a stale `value` prop would drop each other's results.
  const draftRef = useRef(value);
  draftRef.current = value;
  // Count lives in a ref so the parent callback fires OUTSIDE the setState
  // updater (updaters must stay pure), and unmounting mid-upload reports 0 —
  // otherwise a collapsed composer would keep 发布 disabled forever.
  const uploadingRef = useRef(0);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;

  function bump(delta: number) {
    uploadingRef.current = Math.max(0, uploadingRef.current + delta);
    setUploading(uploadingRef.current);
    onUploadingChangeRef.current?.(uploadingRef.current);
  }

  useEffect(() => () => onUploadingChangeRef.current?.(0), []);

  function commit(mutate: (d: MediaDraft) => MediaDraft) {
    const next = mutate(draftRef.current);
    draftRef.current = next;
    onChange(next);
  }

  async function addImages(list: FileList | null) {
    if (!list) return;
    const room = MAX_IMAGES - draftRef.current.images.length;
    const picked = Array.from(list).slice(0, room);
    if (Array.from(list).length > room) pushToast('info', t('max_images_hint', { count: MAX_IMAGES }));
    for (const file of picked) {
      bump(1);
      try {
        const r = await uploadRaw(file, '/api/uploads/image', {});
        commit((d) =>
          d.images.length >= MAX_IMAGES
            ? d
            : {
                ...d,
                images: [
                  ...d.images,
                  { key: r.key, url: r.url, name: file.name, mimeType: file.type, sizeBytes: r.size },
                ],
              },
        );
      } catch (e) {
        pushToast('error', t('image_upload_error', { name: file.name, error: t(uploadErrorKey(e)) }));
      } finally {
        bump(-1);
      }
    }
  }

  async function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    bump(1);
    setVideoPct(0);
    try {
      const r = await uploadRaw(file, '/api/discussion/upload', { 'x-upload-kind': 'video' }, (p) =>
        setVideoPct(p),
      );
      commit((d) => ({
        ...d,
        video: { key: r.key, url: r.url, name: file.name, mimeType: file.type, sizeBytes: r.size },
        videoLink: '', // ONE video per post/topic — upload replaces the link
      }));
      setLinkInputOpen(false);
    } catch (e) {
      pushToast('error', t('video_upload_error', { error: t(uploadErrorKey(e)) }));
    } finally {
      bump(-1);
      setVideoPct(null);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const room = MAX_FILES - draftRef.current.files.length;
    const picked = Array.from(list).slice(0, room);
    if (Array.from(list).length > room) pushToast('info', t('max_files_hint', { count: MAX_FILES }));
    for (const file of picked) {
      bump(1);
      try {
        const r = await uploadRaw(file, '/api/discussion/upload', { 'x-upload-kind': 'file' });
        commit((d) =>
          d.files.length >= MAX_FILES
            ? d
            : {
                ...d,
                files: [
                  ...d.files,
                  { key: r.key, url: r.url, name: file.name, mimeType: file.type, sizeBytes: r.size },
                ],
              },
        );
      } catch (e) {
        pushToast('error', t('file_upload_error', { name: file.name, error: t(uploadErrorKey(e)) }));
      } finally {
        bump(-1);
      }
    }
  }

  function confirmLink() {
    // A video upload in flight would silently overwrite a link confirmed now.
    if (uploadingRef.current > 0) {
      pushToast('info', t('wait_for_upload'));
      return;
    }
    const raw = linkDraft.trim();
    if (!raw) return;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      pushToast('error', t('link_needs_url'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      pushToast('error', t('link_http_only'));
      return;
    }
    commit((d) => ({ ...d, videoLink: parsed.toString(), video: null }));
    setLinkDraft('');
    setLinkInputOpen(false);
  }

  const attachBtn =
    'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800';

  return (
    <div className="space-y-3">
      {value.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.images.map((m) => (
            <div key={m.key} className="relative h-20 w-20 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(m.url)} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() =>
                  commit((d) => ({ ...d, images: d.images.filter((x) => x.key !== m.key) }))
                }
                aria-label={t('remove_image')}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {videoPct !== null && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('video_uploading', { pct: Math.round(videoPct) })}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all" style={{ width: `${videoPct}%` }} />
          </div>
        </div>
      )}

      {value.video && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-800">
            <Play className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{value.video.name}</span>
            <span className="block text-xs text-muted">{formatBytes(value.video.sizeBytes)}</span>
          </span>
          <button
            onClick={() => commit((d) => ({ ...d, video: null }))}
            aria-label={t('remove_video')}
            className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {value.videoLink && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Link2 className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm">{value.videoLink}</span>
          <button
            onClick={() => commit((d) => ({ ...d, videoLink: '' }))}
            aria-label={t('remove_link')}
            className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {value.files.length > 0 && (
        <div className="space-y-2">
          {value.files.map((m) => (
            <div
              key={m.key}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
              <span className="shrink-0 text-xs text-muted">{formatBytes(m.sizeBytes)}</span>
              <button
                onClick={() =>
                  commit((d) => ({ ...d, files: d.files.filter((x) => x.key !== m.key) }))
                }
                aria-label={t('remove_file')}
                className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {linkInputOpen && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmLink()}
            placeholder={t('link_placeholder')}
            className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button
            onClick={confirmLink}
            className="h-9 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
          >
            {t('add')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void addImages(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept={VIDEO_ACCEPT}
          hidden
          onChange={(e) => {
            void addVideo(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => imageInput.current?.click()}
          disabled={value.images.length >= MAX_IMAGES}
          className={attachBtn}
          title={t('attach_image_title', { count: MAX_IMAGES })}
        >
          <ImagePlus className="h-4 w-4" />
          {t('attach_image')}
        </button>
        <button
          onClick={() => videoInput.current?.click()}
          disabled={Boolean(value.video) || uploading > 0}
          className={attachBtn}
          title={t('attach_video_title')}
        >
          <Video className="h-4 w-4" />
          {t('attach_video')}
        </button>
        <button
          onClick={() => setLinkInputOpen((v) => !v)}
          disabled={Boolean(value.videoLink) || uploading > 0}
          className={attachBtn}
          title={t('attach_link_title')}
        >
          <Link2 className="h-4 w-4" />
          {t('attach_link')}
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={value.files.length >= MAX_FILES}
          className={attachBtn}
          title={t('attach_file_title')}
        >
          <Paperclip className="h-4 w-4" />
          {t('attach_file')}
        </button>
      </div>
    </div>
  );
}
