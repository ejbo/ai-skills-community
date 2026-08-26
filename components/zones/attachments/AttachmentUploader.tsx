'use client';

// Post attachment picker (composer): images / videos / files uploaded through
// the raw-body protocol to POST /api/zones/<slug>/attachments/upload with
// `x-upload-kind`, per-file XHR progress, limits from ZONE_ATTACHMENT_LIMITS
// and the MAX_ZONE_* byte caps checked client-side first (the server checks
// again). Copies MediaPicker's invariants: the draft is read from a ref (two
// parallel uploads must not clobber each other), the in-flight count is
// reported OUTSIDE setState and zeroed on unmount.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FileUp, ImagePlus, Loader2, Video } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { withBasePath } from '@/lib/base-path';
import {
  MAX_ZONE_FILE_BYTES,
  MAX_ZONE_IMAGE_BYTES,
  MAX_ZONE_VIDEO_BYTES,
  ZONE_ATTACHMENT_LIMITS,
  ZONE_FILE_ACCEPT,
  ZONE_FILE_EXTS,
  ZONE_IMAGE_TYPES,
  ZONE_MEDIA_KEY_RE,
  ZONE_VIDEO_TYPES,
  extOfName,
  formatBytes,
} from '@/lib/zones/shared';
import type { ZoneAttachmentKindView, ZoneAttachmentView } from '@/lib/zones/types';
import { AttachmentList } from './AttachmentList';

export type UploadKind = ZoneAttachmentKindView;

/** A composer attachment: a saved row (id set) or a fresh upload (id null). */
export interface AttachmentDraft extends Omit<ZoneAttachmentView, 'id'> {
  id: string | null;
  /** Storage key echoed back to the API (`image/…`, `video/…`, `file/…`). */
  key: string;
}

/** Root-relative `/api/zones/media/<enc segments>` → storage key, or null. */
export function zoneMediaKeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^\/api\/zones\/media\/(.+)$/.exec(url.split('?')[0]);
  if (!m) return null;
  let key: string;
  try {
    key = m[1].split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  return ZONE_MEDIA_KEY_RE.test(key) ? key : null;
}

export function draftFromView(v: ZoneAttachmentView): AttachmentDraft | null {
  const key = zoneMediaKeyFromPublicUrl(v.url);
  if (!key) return null;
  return { ...v, id: v.id || null, key };
}

export function draftToView(d: AttachmentDraft): ZoneAttachmentView {
  const { key: _key, ...rest } = d;
  void _key;
  return { ...rest, id: d.id ?? '' };
}

/** The `attachments` array of ZonePostInput. */
export function attachmentPayload(items: AttachmentDraft[]) {
  return items.map((a) => ({
    key: a.key,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    posterKey: zoneMediaKeyFromPublicUrl(a.posterUrl),
  }));
}

export interface RawUploadResult {
  key: string;
  url: string;
  size: number;
  width?: number | null;
  height?: number | null;
  kind?: string;
}

/** Raw-body upload protocol shared by every upload route in the app (XHR for progress; NOT covered by the fetch shim → withBasePath). */
export function uploadRaw(
  file: File,
  endpoint: string,
  extraHeaders: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<RawUploadResult> {
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
          resolve(JSON.parse(xhr.responseText) as RawUploadResult);
        } catch {
          reject(new Error('bad_response'));
        }
      } else {
        let msg = xhr.status === 401 ? 'unauthenticated' : 'upload_failed';
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error || msg;
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

/** Maps an upload error to its `zones` message key. */
export function uploadErrorKey(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  switch (msg) {
    case 'file_too_large':
      return 'attach_err_file_too_large';
    case 'unsupported_type':
      return 'attach_err_unsupported_type';
    case 'rate_limited':
      return 'attach_err_rate_limited';
    case 'forbidden':
      return 'attach_err_forbidden';
    case 'unauthenticated':
      return 'attach_err_unauthenticated';
    default:
      return 'attach_err_upload_failed';
  }
}

const IMAGE_ACCEPT = Array.from(ZONE_IMAGE_TYPES).join(',');
const VIDEO_ACCEPT = Array.from(ZONE_VIDEO_TYPES).join(',');

/** The post schema caps `attachments[].name` at 200 chars (lib/zones/post-queries.ts). */
export const ATTACHMENT_NAME_MAX = 200;

/**
 * A file name longer than the server cap would make the whole post unsaveable
 * with an opaque validation error, so it is shortened HERE — in the middle, so
 * the extension stays readable — and the shortened name is what we display and
 * send.
 */
export function clampAttachmentName(name: string, max = ATTACHMENT_NAME_MAX): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  const headLen = max - ext.length - 1;
  if (headLen <= 0) return name.slice(0, max);
  let head = name.slice(0, headLen);
  // never cut a surrogate pair in half
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return `${head}\u2026${ext}`;
}

function classify(file: File): UploadKind | null {
  if (ZONE_IMAGE_TYPES.has(file.type)) return 'image';
  if (ZONE_VIDEO_TYPES.has(file.type)) return 'video';
  if (ZONE_FILE_EXTS.has(extOfName(file.name))) return 'file';
  return null;
}
const MAX_BYTES: Record<UploadKind, number> = { image: MAX_ZONE_IMAGE_BYTES, video: MAX_ZONE_VIDEO_BYTES, file: MAX_ZONE_FILE_BYTES };
const LIMITS: Record<UploadKind, number> = { image: ZONE_ATTACHMENT_LIMITS.images, video: ZONE_ATTACHMENT_LIMITS.videos, file: ZONE_ATTACHMENT_LIMITS.files };

interface Progress {
  id: number;
  name: string;
  kind: UploadKind;
  pct: number;
}

export function AttachmentUploader({
  zoneSlug,
  value,
  onChange,
  onUploadingChange,
  disabled = false,
}: {
  zoneSlug: string;
  value: AttachmentDraft[];
  onChange: (next: AttachmentDraft[]) => void;
  /** Reports the number of in-flight uploads so the parent can gate submit. */
  onUploadingChange?: (count: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const [progress, setProgress] = useState<Progress[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(value);
  draftRef.current = value;
  const uploadingRef = useRef(0);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const nextId = useRef(1);

  function bump(delta: number) {
    uploadingRef.current = Math.max(0, uploadingRef.current + delta);
    onUploadingChangeRef.current?.(uploadingRef.current);
  }
  useEffect(() => () => onUploadingChangeRef.current?.(0), []);

  function commit(mutate: (d: AttachmentDraft[]) => AttachmentDraft[]) {
    const next = mutate(draftRef.current);
    draftRef.current = next;
    onChange(next);
  }

  const countOf = (kind: UploadKind, list: AttachmentDraft[]) => list.filter((a) => a.kind === kind).length;

  async function uploadOne(file: File, kind: UploadKind) {
    const name = clampAttachmentName(file.name);
    if (file.size > MAX_BYTES[kind]) {
      pushToast('error', t('attach_too_large', { name, max: formatBytes(MAX_BYTES[kind]) }));
      return;
    }
    if (countOf(kind, draftRef.current) >= LIMITS[kind]) {
      pushToast('info', t(`attach_limit_${kind}`, { count: LIMITS[kind] }));
      return;
    }
    const id = nextId.current++;
    setProgress((p) => [...p, { id, name, kind, pct: 0 }]);
    bump(1);
    try {
      const r = await uploadRaw(file, `/api/zones/${encodeURIComponent(zoneSlug)}/attachments/upload`, { 'x-upload-kind': kind }, (pct) =>
        setProgress((p) => p.map((x) => (x.id === id ? { ...x, pct } : x))),
      );
      const ext = extOfName(file.name) || extOfName(r.key);
      commit((d) =>
        countOf(kind, d) >= LIMITS[kind]
          ? d
          : [
              ...d,
              {
                id: null,
                key: r.key,
                kind,
                url: r.url,
                name,
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: r.size,
                width: r.width ?? null,
                height: r.height ?? null,
                posterUrl: null,
                ext,
                previewStatus: 'none',
                previewUrl: null,
              },
            ],
      );
    } catch (e) {
      pushToast('error', t('attach_upload_error', { name, error: t(uploadErrorKey(e)) }));
    } finally {
      bump(-1);
      setProgress((p) => p.filter((x) => x.id !== id));
    }
  }

  async function addFiles(list: FileList | File[] | null, forcedKind?: UploadKind) {
    if (!list || disabled) return;
    const files = Array.from(list);
    for (const file of files) {
      const kind = forcedKind ?? classify(file);
      if (!kind) {
        pushToast('error', t('attach_upload_error', { name: clampAttachmentName(file.name), error: t('attach_err_unsupported_type') }));
        continue;
      }
      // Sequential: the server's burst limiter and the disk both prefer it, and
      // progress rows stay readable.
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(file, kind);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void addFiles(e.dataTransfer?.files ?? null);
  }

  const counts = {
    image: countOf('image', value),
    video: countOf('video', value),
    file: countOf('file', value),
  };
  const busy = progress.length > 0;

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`rounded-xl border border-dashed p-3 transition ${
        dragOver ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900' : 'border-zinc-300 dark:border-zinc-700'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={disabled || counts.image >= LIMITS.image} onClick={() => imageInput.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" />
          {t('attach_add_image')}
          <span className="font-mono tabular-nums text-muted">
            {counts.image}/{LIMITS.image}
          </span>
        </button>
        <button type="button" className={btn} disabled={disabled || counts.video >= LIMITS.video} onClick={() => videoInput.current?.click()}>
          <Video className="h-3.5 w-3.5" />
          {t('attach_add_video')}
          <span className="font-mono tabular-nums text-muted">
            {counts.video}/{LIMITS.video}
          </span>
        </button>
        <button type="button" className={btn} disabled={disabled || counts.file >= LIMITS.file} onClick={() => fileInput.current?.click()}>
          <FileUp className="h-3.5 w-3.5" />
          {t('attach_add_file')}
          <span className="font-mono tabular-nums text-muted">
            {counts.file}/{LIMITS.file}
          </span>
        </button>
        <span className="ml-auto text-[11px] text-muted">{t('attach_drop_hint')}</span>
      </div>

      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files, 'image'); e.target.value = ''; }} />
      <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { void addFiles(e.target.files, 'video'); e.target.value = ''; }} />
      <input ref={fileInput} type="file" accept={ZONE_FILE_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files, 'file'); e.target.value = ''; }} />

      {busy && (
        <ul className="mt-3 space-y-1.5">
          {progress.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <span className="block h-full bg-zinc-900 transition-[width] dark:bg-zinc-100" style={{ width: `${Math.round(p.pct)}%` }} />
              </span>
              <span className="w-9 text-right font-mono tabular-nums text-muted">{Math.round(p.pct)}%</span>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <AttachmentList
          className="mt-3"
          items={value.map(draftToView)}
          onRemove={disabled ? undefined : (index) => commit((d) => d.filter((_, i) => i !== index))}
        />
      )}
      <p className="mt-2 text-[11px] text-muted">
        {t('attach_limits_hint', {
          images: LIMITS.image,
          videos: LIMITS.video,
          files: LIMITS.file,
          imageMax: formatBytes(MAX_ZONE_IMAGE_BYTES),
          videoMax: formatBytes(MAX_ZONE_VIDEO_BYTES),
          fileMax: formatBytes(MAX_ZONE_FILE_BYTES),
        })}
      </p>
    </div>
  );
}
