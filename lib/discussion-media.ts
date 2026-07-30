import { z } from 'zod';
import { prisma } from '@/lib/db';
import { imagePublicUrl } from '@/lib/uploads/image-storage';
import { deletePostMediaFile, postMediaPublicUrl } from '@/lib/uploads/post-media-storage';

// Shared attachment validation for the 讨论区 composers (feed posts AND forum
// topics — both persist the same shape into PostMedia / TopicMedia).

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
export const mediaArraySchema = z.array(mediaItemSchema).max(14, '附件数量过多').default([]);

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
 * invalid item (the caller 400s).
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
      if (!item.key || !/^images\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(item.key)) return null;
      key = item.key;
      url = imagePublicUrl(key);
      images++;
    } else {
      const prefix = item.kind === 'video' ? 'video/' : 'file/';
      if (!item.key || !item.key.startsWith(prefix)) return null;
      if (!/^(video|file)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(item.key)) return null;
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
  if (images > 9 || videos > 1 || files > 4) return null;
  return out;
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
