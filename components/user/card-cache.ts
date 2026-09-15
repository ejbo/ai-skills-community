// 用户卡片 data cache — the fetch half of UserHoverCard, as a plain module (no
// React, no 'use client') so its rules are unit-tested (tests/user-card-cache.test.ts).
//
// One request per member per viewer: a module-level cache + in-flight dedupe.
// The cache holds only DEFINITIVE, session-independent answers — a card (200) or
// "no such member" (404) — for CARD_CACHE_TTL_MS, and is dropped whenever the
// signed-in viewer changes (a view is built per viewer). A 401 or a 5xx is never
// remembered: a visitor who signs in with the credentials form (a soft
// navigation — module state survives) must see cards on the very next hover,
// not "nothing" until a hard reload. Settings editors call invalidateUserCard()
// after a save, so a member's own card is never stale for the rest of the tab.

import { withBasePath } from '@/lib/base-path';
import type { ProfileCardView } from '@/lib/profile/types';

export const CARD_CACHE_TTL_MS = 60_000;

export interface CardCacheEntry {
  view: ProfileCardView | null;
  at: number;
}

const cache = new Map<string, CardCacheEntry>();
const inflight = new Map<string, Promise<ProfileCardView | null>>();
/** Bumped by every invalidation: a request that started before it must not repopulate the cache. */
let generation = 0;
/** The signed-in user the cached entries were fetched as. */
let cacheViewer: string | null = null;

/**
 * Forget cached cards — one handle, or everything. Call after any save that
 * changes what a card shows (名片, 资料, 隐私板块, 标签) so the next hover refetches
 * instead of showing the old card.
 */
export function invalidateUserCard(handle?: string): void {
  generation += 1;
  if (handle === undefined) {
    cache.clear();
    inflight.clear();
    return;
  }
  cache.delete(handle);
  inflight.delete(handle);
}

function syncViewer(viewerId: string | null): void {
  if (viewerId === cacheViewer) return;
  cacheViewer = viewerId;
  invalidateUserCard();
}

/** A cached, unexpired answer for this viewer (a null view = remembered 404), else undefined. */
export function freshCardEntry(handle: string, viewerId: string | null): CardCacheEntry | undefined {
  syncViewer(viewerId);
  const hit = cache.get(handle);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CARD_CACHE_TTL_MS) {
    cache.delete(handle);
    return undefined;
  }
  return hit;
}

/** Shape check at the trust boundary: an older/other payload must close the card, not crash it. */
export function isCardView(v: unknown): v is ProfileCardView {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.handle === 'string' &&
    typeof o.displayName === 'string' &&
    typeof o.theme === 'string' &&
    !!o.card &&
    typeof o.card === 'object' &&
    Array.isArray(o.badges) &&
    Array.isArray(o.stats)
  );
}

/** The member's card for this viewer, or null (no session, unknown member, network/server error). */
export function loadCardView(handle: string, viewerId: string | null): Promise<ProfileCardView | null> {
  const hit = freshCardEntry(handle, viewerId);
  if (hit) return Promise.resolve(hit.view);
  const existing = inflight.get(handle);
  if (existing) return existing;
  const gen = generation;
  const run = async (): Promise<ProfileCardView | null> => {
    try {
      const res = await fetch(withBasePath(`/api/users/${encodeURIComponent(handle)}/card`));
      const body: unknown = res.ok ? await res.json() : null;
      const data = isCardView(body) ? body : null;
      if ((res.ok || res.status === 404) && gen === generation) cache.set(handle, { view: data, at: Date.now() });
      return data;
    } catch {
      return null;
    }
  };
  const p = run().finally(() => {
    if (inflight.get(handle) === p) inflight.delete(handle);
  });
  inflight.set(handle, p);
  return p;
}
