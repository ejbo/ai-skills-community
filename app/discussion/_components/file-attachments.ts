// Pure decisions behind the 讨论区 file cards and their viewer drawer. A plain
// module (no React, no next-intl) so PostMediaGallery, FileViewerDrawer and
// tests/discussion-media.test.ts read the same answers — and so nothing here is
// a client REFERENCE if an RSC ever needs it. The size string, the card's
// EXT · size line and the 下载 href are NOT decided here: they come from
// lib/files/display.ts, shared with 技术专区 and the viewer itself.

import { displayExtOf, previewPlanFor } from '@/lib/files/file-types';
import { postMediaKeyFromUrl } from '@/lib/uploads/post-media-keys';

export interface DiscussionFileTarget {
  /** Root-relative media URL (`/api/discussion/media/file/<id>.<ext>`). */
  url: string;
  /** Storage key behind `url` — its extension decides the renderer. */
  storageKey: string;
  name: string;
  sizeBytes: number;
}

/**
 * The viewer target for a stored `file` row, or null when its URL is not a
 * post-media key (then the card falls back to a plain download link rather
 * than opening a viewer that could only guess).
 */
export function discussionFileTarget(m: { url: string; name: string; sizeBytes: number }): DiscussionFileTarget | null {
  const storageKey = postMediaKeyFromUrl(m.url);
  if (!storageKey) return null;
  return { url: m.url, storageKey, name: m.name, sizeBytes: m.sizeBytes };
}

/**
 * Whether a card says 仅下载: the viewer has no renderer for this key. An
 * extension-less upload (`Makefile` → a `.bin` key) is sniffed when opened, so
 * it promises nothing either way; Office is download-only HERE because the
 * discussion viewer is mounted without an office rendition (that LibreOffice
 * pipeline belongs to 技术专区).
 */
export function isDownloadOnlyFile(storageKey: string, name: string): boolean {
  const plan = previewPlanFor(storageKey, name);
  if (plan.sniffOnly) return false;
  return plan.cls === 'none' || plan.cls === 'office';
}

/**
 * The icon tile's tint. The three document families the board always had keep
 * the colours they wore before any-file attachments (PDF rose, slides amber,
 * documents sky) — content keeps its colour, per the 配色契约; every newer type
 * sits on the neutral tile rather than a palette invented here.
 */
export function fileTileClass(ext: string): string {
  const e = (ext ?? '').toLowerCase();
  if (e === 'pdf') return 'bg-rose-500/10 text-rose-600 dark:text-rose-400';
  if (e === 'ppt' || e === 'pptx' || e === 'odp') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (e === 'doc' || e === 'docx' || e === 'odt') return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
  return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300';
}

/** Display extension for a stored file (compound-aware, never the `bin` placeholder). */
export function discussionFileExt(target: Pick<DiscussionFileTarget, 'name' | 'storageKey'>, mimeType?: string | null): string {
  return displayExtOf(target.name, target.storageKey, mimeType);
}
