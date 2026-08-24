// Client-side upload helpers for 投票活动 — the house raw-body protocol via XHR
// (fetch shim does not cover XHR, so withBasePath is applied manually) plus the
// shorts-style poster frame capture for video entries.

import { withBasePath } from '@/lib/base-path';

export interface UploadedFile {
  key: string;
  url: string;
  size: number;
}

export interface UploadedEntry {
  id: string;
  entryNo: number;
  kind: 'image' | 'video';
  fileUrl: string;
  posterUrl: string | null;
  posterAspect: 'landscape' | 'portrait';
  posterPos: string;
  originalName: string;
  title: string;
  authorName: string;
  authorNo: string;
  titleEdited: boolean;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  hidden: boolean;
  voteCount: number;
}

/** Raw-body upload to /api/votes/[id]/upload. Rejects with the server error code. */
export function uploadVoteMedia(
  activityId: string,
  file: Blob,
  filename: string,
  kind: 'image' | 'video' | 'poster' | 'cover',
  opts?: { entryId?: string; durationSec?: number; onProgress?: (pct: number) => void },
): Promise<{ key?: string; url?: string; size?: number; entry?: UploadedEntry }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (opts?.entryId) params.set('entry', opts.entryId);
    if (opts?.durationSec && opts.durationSec > 0) {
      params.set('duration', String(Math.round(opts.durationSec)));
    }
    const qs = params.toString();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(`/api/votes/${activityId}/upload${qs ? `?${qs}` : ''}`));
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upload-kind', kind);
    xhr.setRequestHeader('x-filename', encodeURIComponent(filename));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts?.onProgress) opts.onProgress((e.loaded / e.total) * 100);
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

/** Raw-body upload to the member submission endpoint (two-phase, shorts-style). */
export function uploadVoteSubmission(
  activityId: string,
  file: Blob,
  filename: string,
  kind: 'media' | 'poster',
  onProgress?: (pct: number) => void,
): Promise<{ key: string; url: string; size: number; kind: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', withBasePath(`/api/votes/${activityId}/submissions/upload`));
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

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

/**
 * Probe duration and capture a poster frame from a picked video file
 * (ShortsUploadDialog pattern). Best-effort — a null poster is fine.
 */
export async function probeAndCapture(
  url: string,
): Promise<{ meta: VideoMeta; poster: Blob | null }> {
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
  }

  const meta: VideoMeta = {
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    width: video.videoWidth || 0,
    height: video.videoHeight || 0,
  };

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
