// 视频截取 — client-side frame capture for <VideoTrimmer/>'s filmstrip and for
// any upload flow that needs a still from a video it can play (a poster at the
// member's chosen cover frame when the server cannot cut one).
//
// React-free and network-free beyond loading `src` into a detached <video>:
// seek → draw onto a canvas → JPEG. Everything is BEST-EFFORT — a codec the
// browser cannot decode (HEVC .mov in some Chrome builds), a seek that never
// settles, or a tainted canvas yields no frame, never an exception.
//
// Object URLs handed to `onFrame` belong to the CALLER (revoke them on unmount);
// a frame finished after `signal` aborted is revoked here and never reported.
//
// Same-origin `src` only (blob:, or a withBasePath'ed app URL): a cross-origin
// video without CORS taints the canvas, which `toBlob` refuses — that case
// just produces no frames.

import { fitFrameLongEdge, frameCanvasSize } from './trim-math';

/** One seek must settle within this; a slower frame is skipped, not waited on. */
const SEEK_TIMEOUT_MS = 6000;
const LOAD_TIMEOUT_MS = 15000;

function loadVideo(src: string, signal?: AbortSignal): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    // METADATA only: every frame is then fetched by the seek that needs it (a few
    // byte ranges around each thumbnail time). `auto` made this detached element
    // download the WHOLE source a second time beside the preview — and an
    // owner-only original is only briefly cacheable (`private, max-age=600`), so
    // the two elements must not each pull the whole file.
    video.preload = 'metadata';
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (ok && video.videoWidth > 0 && video.videoHeight > 0) resolve(video);
      else {
        releaseVideo(video);
        resolve(null);
      }
    };
    // Dimensions + duration are known here; `seek` waits for `seeked`, which only
    // fires once the frame at that time is decodable, so nothing more is needed.
    const onMeta = () => done(true);
    const onError = () => done(false);
    const onAbort = () => done(false);
    const timer = window.setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    video.src = src;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    /* already torn down */
  }
}

function seek(video: HTMLVideoElement, sec: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(Math.max(0, sec), Math.max(0, video.duration - 0.05)) : Math.max(0, sec);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    const onAbort = () => done(false);
    const timer = window.setTimeout(() => done(false), SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    // A seek to the time the element already shows fires no `seeked`.
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      done(true);
      return;
    }
    video.currentTime = target;
  });
}

function drawToBlob(video: HTMLVideoElement, width: number, height: number, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), type, quality);
    } catch {
      // SecurityError (tainted canvas) or a detached decoder.
      resolve(null);
    }
  });
}

export interface FilmstripOptions {
  /** Canvas height of each thumbnail (render height × device pixel ratio is plenty). Default 96. */
  frameHeight?: number;
  signal?: AbortSignal;
}

/**
 * Capture a thumbnail at each of `times` (seconds, in order) and report each as
 * an object URL the moment it is ready, so a strip fills in left to right.
 * Resolves when every frame was attempted (or on abort / an undecodable source,
 * in which case some or all frames were simply never reported).
 */
export async function captureFilmstrip(
  src: string,
  times: readonly number[],
  onFrame: (index: number, url: string) => void,
  { frameHeight = 96, signal }: FilmstripOptions = {},
): Promise<void> {
  if (!src || times.length === 0) return;
  const video = await loadVideo(src, signal);
  if (!video) return;
  try {
    const { width, height } = frameCanvasSize(video.videoWidth, video.videoHeight, frameHeight);
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) return;
      if (!(await seek(video, times[i], signal))) {
        // Aborted, or the element failed outright (a codec it cannot decode): no later seek will fare better.
        if (signal?.aborted || video.error) return;
        continue;
      }
      const blob = await drawToBlob(video, width, height, 'image/jpeg', 0.72);
      if (!blob) continue;
      if (signal?.aborted) return;
      onFrame(i, URL.createObjectURL(blob));
    }
  } finally {
    releaseVideo(video);
  }
}

export interface FrameOptions {
  /** Long edge of the still, px (never upscaled). Default 1280. */
  maxEdge?: number;
  /** Output type — `image/jpeg` (default) or `image/webp`. */
  type?: string;
  quality?: number;
  signal?: AbortSignal;
}

/**
 * One still of `src` at `atSec` — e.g. the poster at the cover frame a member
 * chose. null when the source cannot be decoded here or the seek never settles.
 */
export async function captureVideoFrame(
  src: string,
  atSec: number,
  { maxEdge = 1280, type = 'image/jpeg', quality = 0.86, signal }: FrameOptions = {},
): Promise<Blob | null> {
  if (!src) return null;
  const video = await loadVideo(src, signal);
  if (!video) return null;
  try {
    if (!(await seek(video, atSec, signal))) return null;
    const { width, height } = fitFrameLongEdge(video.videoWidth, video.videoHeight, maxEdge);
    return await drawToBlob(video, width, height, type, quality);
  } finally {
    releaseVideo(video);
  }
}
