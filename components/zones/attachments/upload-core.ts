// 技术专区 attachment upload core — the React-free half of the composer's
// upload path, shared by AttachmentUploader (the ledger under the body) and
// RichTextEditor (drop / paste / 📎 at the caret). Pure helpers + the raw-body
// XHR protocol; no next-intl, no React, so the editor never has to import the
// uploader component and the file-upload plugin can stay a plain module.
//
// Contract (SPEC §1.10): `AttachmentUploader.tsx` re-exports every name below
// that other code already imported from it.

import { withBasePath } from '@/lib/base-path';
import {
  MAX_ZONE_FILE_BYTES,
  MAX_ZONE_IMAGE_BYTES,
  MAX_ZONE_VIDEO_BYTES,
  ZONE_FILE_EXTS,
  ZONE_IMAGE_TYPES,
  ZONE_MEDIA_KEY_RE,
  ZONE_VIDEO_TYPES,
  extOfName,
} from '@/lib/zones/shared';
import type { ZoneAttachmentKindView, ZoneAttachmentView } from '@/lib/zones/types';

export type UploadKind = ZoneAttachmentKindView;

/** A composer attachment: a saved row (id set) or a fresh upload (id null). */
export interface AttachmentDraft extends Omit<ZoneAttachmentView, 'id'> {
  id: string | null;
  /** Storage key echoed back to the API (`image/…`, `video/…`, `file/…`). */
  key: string;
}

/**
 * Typed upload failure. `code` is the route's `error` string ('rate_limited',
 * 'file_too_large', 'unsupported_type', 'forbidden', 'unauthenticated',
 * 'network_error', 'bad_response', 'upload_failed') or the client-side
 * 'aborted'. A 429 carries `retryAfterMs` from the `retry-after` header so the
 * sequential queues can sleep instead of failing the file.
 */
export class UploadError extends Error {
  code: string;
  retryAfterMs?: number;
  constructor(code: string, retryAfterMs?: number) {
    super(code);
    this.name = 'UploadError';
    this.code = code;
    if (retryAfterMs != null) this.retryAfterMs = retryAfterMs;
  }
}

/** Fallback when a 429 arrives without a usable `retry-after` header. */
const DEFAULT_RETRY_AFTER_MS = 15_000;

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

/** `POST /api/zones/<slug>/attachments/upload` (root-relative; `uploadRaw` applies the basePath). */
export function uploadEndpoint(zoneSlug: string): string {
  return `/api/zones/${encodeURIComponent(zoneSlug)}/attachments/upload`;
}

function parseRetryAfterMs(raw: string | null): number {
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * Raw-body upload protocol shared by every upload route in the app (XHR for
 * progress; NOT covered by the fetch shim → withBasePath). Rejects with an
 * `UploadError`; `signal` aborts the XHR (→ code 'aborted').
 */
export function uploadRaw(
  file: File,
  endpoint: string,
  extraHeaders: Record<string, string>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<RawUploadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError('aborted'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(endpoint));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    for (const [k, v] of Object.entries(extraHeaders)) xhr.setRequestHeader(k, v);
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = () => signal?.removeEventListener('abort', onAbort);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as RawUploadResult);
        } catch {
          reject(new UploadError('bad_response'));
        }
        return;
      }
      let code = xhr.status === 401 ? 'unauthenticated' : 'upload_failed';
      try {
        code = (JSON.parse(xhr.responseText) as { error?: string }).error || code;
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status === 429) code = 'rate_limited';
      reject(new UploadError(code, code === 'rate_limited' ? parseRetryAfterMs(xhr.getResponseHeader('retry-after')) : undefined));
    };
    xhr.onerror = () => {
      settle();
      reject(new UploadError('network_error'));
    };
    xhr.onabort = () => {
      settle();
      reject(new UploadError('aborted'));
    };
    xhr.send(file);
  });
}

/** The error code of an upload failure ('' for foreign errors). */
export function uploadErrorCode(e: unknown): string {
  if (e instanceof UploadError) return e.code;
  return e instanceof Error ? e.message : '';
}

/** Maps an upload error to its `zones` message key. */
export function uploadErrorKey(e: unknown): string {
  switch (uploadErrorCode(e)) {
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
      // 'aborted', 'network_error', 'bad_response', 'upload_failed', unknown
      return 'attach_err_upload_failed';
  }
}

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
  return `${head}…${ext}`;
}

/** Attachment kind of a File by MIME (images / videos) or extension (files); null = unsupported. */
export function classify(file: File): UploadKind | null {
  if (ZONE_IMAGE_TYPES.has(file.type)) return 'image';
  if (ZONE_VIDEO_TYPES.has(file.type)) return 'video';
  if (ZONE_FILE_EXTS.has(extOfName(file.name))) return 'file';
  return null;
}

/** Per-file byte caps (the only attachment limits left — counts are unlimited). */
export const MAX_BYTES: Record<UploadKind, number> = {
  image: MAX_ZONE_IMAGE_BYTES,
  video: MAX_ZONE_VIDEO_BYTES,
  file: MAX_ZONE_FILE_BYTES,
};

/** The draft row for a finished upload — ONE builder so the ledger and the editor agree on the shape. */
export function draftFromUpload(file: File, kind: UploadKind, r: RawUploadResult, name = clampAttachmentName(file.name)): AttachmentDraft {
  return {
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
    ext: extOfName(file.name) || extOfName(r.key),
    previewStatus: 'none',
    previewUrl: null,
  };
}

/** Sleep helper for the 429 queues (capped so a bogus header cannot park a file for an hour). */
export const MAX_RETRY_WAIT_MS = 60_000;
export const MAX_RATE_LIMIT_RETRIES = 3;
export function retryWaitMs(e: unknown): number {
  const ms = e instanceof UploadError && e.retryAfterMs != null ? e.retryAfterMs : DEFAULT_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(1000, ms));
}
