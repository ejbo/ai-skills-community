// Video object storage — the EXTERNAL adapter (Vercel Blob, browser direct
// upload). Kept fully separate from lib/storage (which skill bundles depend on,
// with addRandomSuffix:false). Video uploads use addRandomSuffix:true so the
// public URL is an unguessable capability URL.
//
// External -> internal roadmap: to move to an internal S3-compatible object
// store (MinIO / Huawei OBS) later, add an S3 presigned-PUT adapter and select
// it via env — the routes/components only depend on the two functions exported
// here plus the client `upload()` call, not on Vercel specifics.

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { auth } from '@/lib/auth';

export const VIDEO_BLOB_PREFIX = 'videos';

const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// Large safety valves to block accidental absurd uploads — NOT a limit on
// normal videos. Adjust to your storage/bandwidth budget (spec §13).
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

function isPosterPath(pathname: string): boolean {
  return pathname.includes('/poster/') || /\.(jpe?g|png|webp|avif)$/i.test(pathname);
}

/**
 * Server handler for `@vercel/blob/client`'s direct upload. Admin-only: the
 * token is only issued to an admin session. Returns the response body that the
 * POST /api/videos/blob-upload route forwards back to the browser.
 */
export async function handleVideoBlobUpload(request: Request, body: HandleUploadBody) {
  return handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      const session = await auth();
      if (!session?.user?.isAdmin) {
        throw new Error('forbidden: admin only');
      }
      const image = isPosterPath(pathname);
      return {
        allowedContentTypes: image ? IMAGE_CONTENT_TYPES : VIDEO_CONTENT_TYPES,
        maximumSizeInBytes: image ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES,
        addRandomSuffix: true, // unguessable capability URL
        tokenPayload: JSON.stringify({ userId: session.user.id }),
      };
    },
    // Row creation happens in POST /api/videos after the client upload resolves,
    // so onUploadCompleted is a no-op (it also isn't invoked in local dev).
    onUploadCompleted: async () => {
      /* no-op */
    },
  });
}

/** Best-effort delete of a blob by its public URL (e.g. when a video is removed). */
export async function deleteVideoBlob(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await del(url);
  } catch {
    /* ignore — storage cleanup is best-effort */
  }
}

/** Client-side helper: build the upload pathname (random suffix added by token). */
export function videoUploadPathname(kind: 'source' | 'poster', originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || (kind === 'poster' ? 'poster.jpg' : 'source.mp4');
  return `${VIDEO_BLOB_PREFIX}/${kind}/${safe}`;
}
