// 译文 freshness + lock constants — split out of translate-doc.ts so read paths
// (lib/library-queries.ts, the status route) never pull the pass's jsdom /
// provider imports in just to compare a hash.

import { createHash } from 'node:crypto';

/** A `running` pass whose heartbeat is older than this may be re-claimed (crashed / restarted). */
export const STALE_LOCK_MS = 10 * 60 * 1000;

/** Marker written by the 2026-10-07 migration for chapters translated under the old one-direction scheme. */
export const LEGACY_SOURCE_HASH = 'legacy';

export function chapterSourceHash(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

/**
 * A stored chapter translation is usable when it was built from the chapter's
 * CURRENT html. Legacy rows predate the hash and are shown as they always were
 * (the old scheme never invalidated either); the next pass rebuilds them from
 * the passage cache at no model cost.
 */
export function isFreshChapterTranslation(row: { sourceHash: string }, html: string): boolean {
  return row.sourceHash === LEGACY_SOURCE_HASH || row.sourceHash === chapterSourceHash(html);
}

/** A pass row as readers see it: a `running` row nobody has touched for the stale window reads as never started. */
export function effectivePassState<S extends string>(row: { state: S; heartbeatAt: Date } | null | undefined): S | 'none' {
  if (!row) return 'none';
  if (row.state === 'running' && Date.now() - row.heartbeatAt.getTime() > STALE_LOCK_MS) return 'none';
  return row.state;
}

/** Chapter order for a pass: `start`, the ones after it, then wrap to the beginning. */
export function passOrder<T extends { chapterIndex: number }>(chapters: T[], start?: number): T[] {
  if (start === undefined || !Number.isFinite(start)) return chapters;
  const i = chapters.findIndex((c) => c.chapterIndex >= start);
  return i <= 0 ? chapters : [...chapters.slice(i), ...chapters.slice(0, i)];
}
