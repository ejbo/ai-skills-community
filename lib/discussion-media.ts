import { z } from 'zod';
import { prisma } from '@/lib/db';
import { imagePublicUrl } from '@/lib/uploads/image-storage';
import { deletePostMediaFile } from '@/lib/uploads/post-media-storage';
import {
  MAX_POST_FILES,
  MAX_POST_IMAGES,
  MAX_POST_MEDIA_ITEMS,
  MAX_POST_VIDEOS,
  POST_IMAGE_KEY_RE,
  isValidPostMediaKey,
  postMediaPublicUrl,
} from '@/lib/uploads/post-media-keys';

// Shared attachment validation for the 讨论区 composers (feed posts AND forum
// topics — both persist the same shape into PostMedia / TopicMedia).
//
// Key shapes and count limits come from lib/uploads/post-media-keys.ts, the
// module the upload route WRITES keys with. That lockstep is the point: a
// `file/<id>.properties` or `file/<id>.c` key the storage produced but a copy of
// the regex here rejected would make every later edit of that topic a 400
// (media_invalid) — and resolveMedia refuses the whole list rather than
// filtering it, precisely so a key it does not understand can never silently
// fall out of an edit and get its file unlinked (see removedUploadKeys).

export const mediaItemSchema = z.object({
  kind: z.enum(['image', 'video', 'video_link', 'file']),
  // Uploaded kinds identify the asset by its storage key (the URL is recomputed
  // server-side); video_link carries the external URL instead.
  key: z.string().min(1).max(512).optional(),
  url: z.string().min(1).max(2048).optional(),
  name: z.string().max(200).default(''),
  mimeType: z.string().max(100).default(''),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
});

// 9 images + 1 video/link + 4 files — must fit everything the picker allows
// (resolveMedia enforces the real per-kind limits).
export const mediaArraySchema = z.array(mediaItemSchema).max(MAX_POST_MEDIA_ITEMS, '附件数量过多').default([]);

export type MediaInput = z.infer<typeof mediaItemSchema>;

export interface ResolvedMedia {
  kind: MediaInput['kind'];
  key: string;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

/**
 * Re-derive each attachment's URL from its storage key so a crafted request
 * can never make a post/topic point at an arbitrary path. Returns null on any
 * invalid item (the caller 400s) — ALL or nothing, never a filtered subset: a
 * topic edit replaces its media wholesale and unlinks what dropped out, so a
 * silently skipped item would delete a file its author never removed.
 */
export function resolveMedia(items: MediaInput[]): ResolvedMedia[] | null {
  const out: ResolvedMedia[] = [];
  let images = 0;
  let videos = 0;
  let files = 0;

  for (const item of items) {
    let key = '';
    let url = '';
    if (item.kind === 'video_link') {
      const raw = (item.url ?? '').trim();
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return null;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      url = parsed.toString();
      videos++;
    } else if (item.kind === 'image') {
      if (!item.key || !POST_IMAGE_KEY_RE.test(item.key)) return null;
      key = item.key;
      url = imagePublicUrl(key);
      images++;
    } else {
      // `video` keys are the three inline containers; `file` keys carry any
      // extension safeKeyExt writes (`[a-z0-9]{1,10}`, `bin` for none).
      if (!item.key || !isValidPostMediaKey(item.key, item.kind)) return null;
      key = item.key;
      url = postMediaPublicUrl(key);
      if (item.kind === 'video') videos++;
      else files++;
    }
    out.push({
      kind: item.kind,
      key,
      url,
      name: item.name.trim().slice(0, 200),
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      width: item.width ?? null,
      height: item.height ?? null,
      sortOrder: out.length,
    });
  }

  // Card layout limits: an image gallery, at most ONE video (uploaded or
  // linked), and a short attachment list.
  if (images > MAX_POST_IMAGES || videos > MAX_POST_VIDEOS || files > MAX_POST_FILES) return null;
  return out;
}

/**
 * The uploaded (video / file) keys an edit DROPS: stored on the entity before,
 * absent from the validated replacement. Only these may be handed to
 * deleteUnreferencedMediaFiles. Images are shared editor infrastructure and
 * never reclaimed here. Call it only with a non-null resolveMedia result.
 */
export function removedUploadKeys(
  before: { kind: string; key: string | null }[],
  next: Pick<ResolvedMedia, 'key'>[],
): string[] {
  const kept = new Set(next.map((m) => m.key).filter(Boolean));
  return [
    ...new Set(
      before
        .filter((m): m is { kind: string; key: string } => (m.kind === 'video' || m.kind === 'file') && Boolean(m.key))
        .filter((m) => !kept.has(m.key))
        .map((m) => m.key),
    ),
  ];
}

/**
 * Uploaded video/file keys are readable from any rendered player/download URL,
 * so key format alone doesn't prove the actor uploaded the file. Reject
 * video/file keys that are ALREADY attached to some other post/topic — that
 * closes the "attach someone else's upload, then delete it out from under
 * them" hole (there is no per-key ownership ledger to check against). Editor
 * images are shared never-GC'd infrastructure and stay reusable.
 * Pass the entity being edited so its own attachments re-validate.
 */
export async function mediaKeysAvailable(
  media: ResolvedMedia[],
  opts: { excludePostId?: string; excludeTopicId?: string } = {},
): Promise<boolean> {
  const keys = media.filter((m) => m.kind === 'video' || m.kind === 'file').map((m) => m.key);
  if (keys.length === 0) return true;
  const [posts, topics] = await Promise.all([
    prisma.postMedia.count({
      where: { key: { in: keys }, ...(opts.excludePostId ? { postId: { not: opts.excludePostId } } : {}) },
    }),
    prisma.topicMedia.count({
      where: {
        key: { in: keys },
        ...(opts.excludeTopicId ? { topicId: { not: opts.excludeTopicId } } : {}),
      },
    }),
  ]);
  return posts + topics === 0;
}

/**
 * Best-effort disk reclamation that is safe against shared keys: unlink an
 * uploaded video/file ONLY when no PostMedia/TopicMedia row references it
 * anymore. Call AFTER the owning rows were deleted.
 */
export async function deleteUnreferencedMediaFiles(keys: string[]): Promise<void> {
  for (const key of [...new Set(keys.filter(Boolean))]) {
    try {
      const [posts, topics] = await Promise.all([
        prisma.postMedia.count({ where: { key } }),
        prisma.topicMedia.count({ where: { key } }),
      ]);
      if (posts + topics === 0) await deletePostMediaFile(key);
    } catch {
      /* best-effort — orphans are reclaimed on the next delete touching the key */
    }
  }
}
